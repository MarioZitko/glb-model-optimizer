import type { MeshSettings, TextureSettings } from '../types/model';
import { Collapsible, Notice, Select, Slider, Toggle } from './ui';

interface Props {
  mesh: MeshSettings;
  texture: TextureSettings;
  disabled: boolean;
  onMesh: (patch: Partial<MeshSettings>) => void;
  onTexture: (patch: Partial<TextureSettings>) => void;
}

export function MeshSettingsPanel({ mesh, disabled, onMesh }: Pick<Props, 'mesh' | 'disabled' | 'onMesh'>) {
  const meshopt = mesh.compression === 'meshopt';
  return (
    <div className={disabled ? 'pointer-events-none opacity-50' : ''}>
      <Toggle
        label="Mesh simplification"
        checked={mesh.simplify}
        onChange={(simplify) => onMesh({ simplify })}
        tip="Reduces triangle count with meshoptimizer's edge-collapse simplifier. Biggest win for TRELLIS models. Downside: fine surface detail is lost as the ratio drops. UV seams and material boundaries are preserved."
      />
      <Slider
        label="Target triangle ratio"
        value={mesh.ratio}
        min={0.05}
        max={1}
        step={0.01}
        disabled={!mesh.simplify}
        onChange={(ratio) => onMesh({ ratio })}
        format={(v) => `${Math.round(v * 100)}% of triangles`}
        tip="Fraction of triangles to aim for (0.5 = half). It is a target, not a guarantee: simplification stops early when the error tolerance would be exceeded."
      />
      <Slider
        label="Error tolerance"
        value={mesh.error}
        min={0.0001}
        max={0.1}
        step={0.0001}
        disabled={!mesh.simplify}
        onChange={(error) => onMesh({ error })}
        format={(v) => `${(v * 100).toFixed(2)}% of model size`}
        tip="Maximum allowed surface deviation, relative to the model's size (0.01 = 1%). Lower keeps the shape more faithful but may prevent reaching the target ratio. Higher lets the ratio be reached with more visible distortion."
      />

      <Collapsible title="Cleanup & advanced">
        <Toggle label="Remove unused data" checked={mesh.prune} onChange={(prune) => onMesh({ prune })} tip="Removes nodes, materials, textures and vertex data nothing references (prune). Safe, and it reduces file size." />
        <Toggle label="Deduplicate resources" checked={mesh.dedup} onChange={(dedup) => onMesh({ dedup })} tip="Merges byte-identical accessors, meshes, materials and textures (dedup). Safe; reduces file size and can reduce material count." />
        <Toggle
          label="Weld vertices"
          checked={mesh.weld}
          onChange={(weld) => onMesh({ weld })}
          tip="Merges vertices that are completely identical (position, normal, UV…). TRELLIS exports duplicate every vertex per triangle, so this greatly reduces vertex count and is needed for good simplification. Vertices on UV seams stay separate."
        />
        <Toggle
          label="Join compatible meshes"
          checked={mesh.join}
          onChange={(join) => onMesh({ join })}
          note="Can change the node hierarchy"
          tip="Merges sibling primitives that share a material into one, reducing draw calls. Downside: separate objects become one mesh, so you can no longer move them individually in Unity. Has no effect on single-mesh TRELLIS models."
        />
        <Toggle
          label="Lock mesh borders"
          checked={mesh.lockBorder}
          onChange={(lockBorder) => onMesh({ lockBorder })}
          note="For open meshes / tiles"
          tip="Prevents the simplifier from moving vertices on open boundaries (holes, edges of a plane). Use when the model must line up exactly with other geometry. Reduces how far simplification can go."
        />
        <Toggle
          label="Reorder mesh data"
          checked={meshopt || mesh.reorder}
          disabled={meshopt}
          onChange={(reorder) => onMesh({ reorder })}
          note={meshopt ? 'Included in Meshopt compression' : undefined}
          tip="Reorders triangles and vertices for GPU vertex-cache efficiency. Doesn't change appearance or counts. Safe."
        />
        <Toggle
          label="Mesh quantization"
          checked={meshopt || mesh.quantize}
          disabled={meshopt}
          onChange={(quantize) => onMesh({ quantize })}
          note={meshopt ? 'Included in Meshopt compression' : 'Adds KHR_mesh_quantization'}
          tip="Stores positions, normals and UVs as smaller integers (KHR_mesh_quantization). Supported by Unity glTFast with no extra package. Smaller file and GPU memory, at a tiny precision loss. Off by default for maximum importer compatibility."
        />
        <Select
          label="Mesh compression"
          value={mesh.compression}
          onChange={(compression) => onMesh({ compression })}
          options={[
            { value: 'none', label: 'None' },
            { value: 'meshopt', label: 'Meshopt' },
          ]}
          tip="Meshopt (EXT_meshopt_compression) makes geometry much smaller on disk. It does not reduce triangles or GPU cost. In Unity, glTFast needs the com.unity.meshopt.decompress package to load it."
        />
        {meshopt && (
          <div className="mt-1">
            <Notice kind="warn">Unity needs the com.unity.meshopt.decompress package to import this file with glTFast.</Notice>
          </div>
        )}
      </Collapsible>
    </div>
  );
}

export function TextureSettingsPanel({ texture, disabled, onTexture }: Pick<Props, 'texture' | 'disabled' | 'onTexture'>) {
  const off = !texture.enabled;
  return (
    <div className={disabled ? 'pointer-events-none opacity-50' : ''}>
      <Toggle
        label="Enable texture optimization"
        checked={texture.enabled}
        onChange={(enabled) => onTexture({ enabled })}
        tip="Resizes and/or re-encodes embedded PNG/JPEG textures. Textures are often the largest part of a TRELLIS GLB. UV mapping is never changed."
      />
      <Select
        label="Color texture format"
        value={texture.format}
        disabled={off}
        onChange={(format) => onTexture({ format })}
        options={[
          { value: 'original', label: 'Keep original' },
          { value: 'jpeg', label: 'JPEG' },
          { value: 'png', label: 'PNG (lossless)' },
        ]}
        tip="Applies to color textures (base color, emissive) only. Normal, roughness/metal and occlusion maps keep their format because lossy compression distorts their data. WebP is not offered: Unity glTFast cannot load it."
      />
      <Slider
        label="JPEG quality"
        value={texture.quality}
        min={1}
        max={100}
        step={1}
        disabled={off || texture.format !== 'jpeg'}
        onChange={(quality) => onTexture({ quality })}
        tip="Higher = better quality and a bigger file. 80–90 is usually visually lossless for baked textures. Only applies when JPEG is selected."
      />
      <Select
        label="Maximum resolution"
        value={texture.maxSize}
        disabled={off}
        onChange={(maxSize) => onTexture({ maxSize })}
        options={[
          { value: 0, label: 'Original' },
          { value: 4096, label: '4096 px' },
          { value: 2048, label: '2048 px' },
          { value: 1024, label: '1024 px' },
          { value: 512, label: '512 px' },
        ]}
        tip="Downscales larger textures to fit within this size, keeping aspect ratio. Applies to all texture types. Smaller textures are never upscaled."
      />
      <Toggle
        label="Preserve alpha transparency"
        checked={texture.preserveAlpha}
        disabled={off}
        onChange={(preserveAlpha) => onTexture({ preserveAlpha })}
        tip="When converting to JPEG, textures used by transparent (BLEND/MASK) materials stay PNG to keep their alpha channel. If disabled, alpha is discarded and those materials become opaque."
      />
    </div>
  );
}
