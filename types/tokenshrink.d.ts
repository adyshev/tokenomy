declare module "tokenshrink" {
  export interface CompressionResult {
    compressed: string;
    original: string;
    rosetta: string;
    compressedBody?: string;
    stats: {
      tokensSaved: number;
      [key: string]: unknown;
    };
  }

  export function compress(
    text: string,
    options?: {
      domain?: string;
      forceStrategy?: string;
      tokenizer?: (text: string) => number;
    },
  ): CompressionResult;

  export function countTokens(
    text: string,
    tokenizer?: (text: string) => number,
  ): number;
}
