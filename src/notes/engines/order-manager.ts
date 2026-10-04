import { LexoRank } from 'lexorank';

export class OrderManager {
  static readonly MIN_RANK = LexoRank.min();
  static readonly MAX_RANK = LexoRank.max();

  static first(): string {
    return LexoRank.min().toString();
  }

  static middle(): string {
    return LexoRank.middle().toString();
  }

  static nextAtEnd(ranks: string[]): string {
    if (ranks.length === 0) return LexoRank.min().toString();
    const last = LexoRank.parse(ranks[ranks.length - 1]);
    return last.genNext().toString();
  }

  static between(prev: string, next: string): string {
    const p = LexoRank.parse(prev);
    const n = LexoRank.parse(next);
    return p.between(n).toString();
  }

  static renumber(ranks: string[]): string[] {
    if (ranks.length === 0) return [];
    const result: string[] = [];
    let current = LexoRank.min();
    for (let i = 0; i < ranks.length; i++) {
      result.push(current.toString());
      current = current.genNext();
    }
    return result;
  }

  static compare(a: string, b: string): number {
    return LexoRank.parse(a).compareTo(LexoRank.parse(b));
  }
}
