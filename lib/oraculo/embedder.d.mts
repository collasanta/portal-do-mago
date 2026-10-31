export const MODEL: string;
export const REVISION: string;
export const DTYPE: string;
export const DIMS: number;
export const MODELS_DIR: string;
export function embedQuery(text: string): Promise<number[]>;
export function embedPassages(texts: string[], batch?: number, onBatch?: (i: number, vecs: number[][]) => unknown): Promise<number[][]>;
export function warm(): Promise<void>;
