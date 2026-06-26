/** @openagentaudit/core/contamination — skeleton. */
export interface ContaminationResult {
  candidate_pairs: number;
  high_similarity_pairs: number;
  method: 'exact' | 'ngram' | 'minhash';
}

export async function contamination(): Promise<ContaminationResult> {
  return { candidate_pairs: 0, high_similarity_pairs: 0, method: 'exact' };
}
