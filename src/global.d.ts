import type { ModelOptimizerApi } from './types/model';

declare global {
  interface Window {
    api: ModelOptimizerApi;
  }
}
