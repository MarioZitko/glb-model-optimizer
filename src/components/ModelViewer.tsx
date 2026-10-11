import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ViewerPrefs } from '../types/model';
import { fmtInt } from '../format';
import { Icon, ICONS } from './ui';

// ---------------------------------------------------------------------------------------------
// Camera sync: a tiny bus both viewers publish to and subscribe from.

export interface CameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
}
export class CameraSync {
  private listeners = new Map<string, (s: CameraState) => void>();
  subscribe(id: string, fn: (s: CameraState) => void) {
    this.listeners.set(id, fn);
    return () => {
      this.listeners.delete(id);
    };
  }
  publish(from: string, s: CameraState) {
    for (const [id, fn] of this.listeners) if (id !== from) fn(s);
  }
}

const BACKGROUNDS: Record<ViewerPrefs['background'], string> = { dark: '#15181f', gray: '#3a3f4a', light: '#d9dce3' };

// ---------------------------------------------------------------------------------------------

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function parseGlb(bytes: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) =>
    loader.parse(
      bytes,
      '',
      (gltf) => {
        // Sharper textures at grazing angles; avoids shimmering while orbiting.
        gltf.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (m?.map) m.map.anisotropy = 8;
        });
        resolve(gltf.scene);
      },
      reject,
    ),
  );
}

function disposeScene(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

function Environment() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    invalidate(); // frameloop is on-demand
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

/** Centers the model on the grid (preview only) and frames the camera on it. */
function Stage(props: {
  model: THREE.Group;
  wireframe: boolean;
  grid: boolean;
  resetKey: number;
  id: string;
  sync: CameraSync | null;
}) {
  const { model, wireframe, grid, resetKey, id, sync } = props;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const applying = useRef(false);

  const { radius, floorY } = useMemo(() => {
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return { radius: 1, floorY: 0 };
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center); // center at origin
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    return { radius: Math.max(sphere.radius, 1e-3), floorY: box.min.y - center.y };
  }, [model]);

  useEffect(() => {
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) (m as THREE.MeshStandardMaterial).wireframe = wireframe;
    });
    invalidate();
  }, [model, wireframe, invalidate]);

  // Frame on load and on reset.
  useEffect(() => {
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    camera.near = radius / 100;
    camera.far = radius * 100;
    camera.position.copy(new THREE.Vector3(0.9, 0.55, 1).normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [camera, radius, resetKey, invalidate]);

  useEffect(() => {
    if (!sync) return;
    return sync.subscribe(id, (s) => {
      if (!controls.current) return;
      applying.current = true;
      camera.position.copy(s.position);
      controls.current.target.copy(s.target);
      controls.current.update();
      applying.current = false;
    });
  }, [sync, id, camera]);

  return (
    <>
      <primitive object={model} />
      {grid && (
        <Grid
          position={[0, floorY - radius * 0.001, 0]}
          args={[radius * 4, radius * 4]}
          cellSize={radius / 5}
          sectionSize={radius}
          cellColor="#3a3f4c"
          sectionColor="#565d6e"
          fadeDistance={radius * 8}
          fadeStrength={1.5}
          infiniteGrid
        />
      )}
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping={false}
        minDistance={radius * 0.05}
        maxDistance={radius * 20}
        onChange={() => {
          if (applying.current || !sync || !controls.current) return;
          sync.publish(id, { position: camera.position.clone(), target: controls.current.target.clone() });
        }}
      />
    </>
  );
}

interface ViewerProps {
  id: string;
  title: string;
  /** GLB bytes; null = nothing to show. */
  bytes: ArrayBuffer | null;
  triangles: number | null;
  emptyText: string;
  busy?: boolean;
  prefs: ViewerPrefs;
  sync: CameraSync | null;
  resetKey: number;
}

export default function ModelViewer({ id, title, bytes, triangles, emptyText, busy, prefs, sync, resetKey }: ViewerProps) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [localReset, setLocalReset] = useState(0);

  useEffect(() => {
    if (!bytes) {
      setModel(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let loaded: THREE.Group | null = null;
    setLoading(true);
    setError(null);
    parseGlb(bytes)
      .then((scene) => {
        if (cancelled) return disposeScene(scene);
        let meshes = 0;
        scene.traverse((o) => ((o as THREE.Mesh).isMesh ? meshes++ : null));
        if (meshes === 0) setError('The model loaded but contains no visible geometry.');
        loaded = scene;
        setModel(scene);
      })
      .catch((err: unknown) => !cancelled && setError(`Could not display model: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (loaded) disposeScene(loaded);
    };
  }, [bytes]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">{title}</h3>
        {triangles !== null && (
          <span className="tabular rounded bg-panel-2 px-1.5 py-0.5 text-[11.5px] text-fg/90">{fmtInt(triangles)} triangles</span>
        )}
        <button
          type="button"
          onClick={() => setLocalReset((n) => n + 1)}
          disabled={!model}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-40"
          title="Reset camera"
        >
          <Icon d={ICONS.reset} className="size-3.5" /> Reset
        </button>
      </div>
      <div className="relative min-h-0 flex-1" style={{ background: BACKGROUNDS[prefs.background] }}>
        {model && (
          <Canvas
            camera={{ fov: 40 }}
            dpr={[1, 1.5]}
            frameloop="demand"
            gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
          >
            <color attach="background" args={[BACKGROUNDS[prefs.background]]} />
            <Environment />
            <hemisphereLight args={['#ffffff', '#444455', 0.6]} />
            <directionalLight position={[3, 5, 4]} intensity={1.2} />
            <Stage model={model} wireframe={prefs.wireframe} grid={prefs.grid} resetKey={resetKey + localReset} id={id} sync={prefs.syncCameras ? sync : null} />
          </Canvas>
        )}
        {(!bytes || error || loading || busy) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[12.5px]">
            {loading || busy ? (
              <div className="size-7 animate-spin rounded-full border-2 border-line border-t-accent" />
            ) : error ? (
              <span className="text-err">{error}</span>
            ) : (
              <>
                <Icon d={ICONS.cube} className="size-8 text-muted/60" />
                <span className="text-muted">{emptyText}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
