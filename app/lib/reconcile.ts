import { Transaction } from '../types';

// 1. 金額を整数（最小通貨単位）に変換するユーティリティ
export const toCents = (amount: number): number => Math.round(amount * 100);

// 2. スコアリング関数
export const calculateConfidence = (targetAmount: number, targetTime: number, candidates: Transaction[]): number => {
  let score = 100;
  // 日付の乖離による減点 (1日離れるごとに -5点)
  const avgTime = candidates.reduce((sum, c) => sum + new Date(c.date).getTime(), 0) / candidates.length;
  const daysDiff = Math.abs(targetTime - avgTime) / (1000 * 60 * 60 * 24);
  score -= daysDiff * 5;

  // 要素数による減点 (組み合わせが多いほど偶然の可能性が上がるため)
  score -= (candidates.length - 1) * 10;
  
  return score;
};

// 3. 枝刈り付きバックトラッキング（1対N の探索）
export const findSubsetSum = (
  targetAmount: number,
  candidates: Transaction[],
  maxDepth: number = 5
): Transaction[][] => {
  const targetCents = toCents(targetAmount);
  if (targetCents === 0) return []; // 金額0のマッチングは無意味なのでスキップ
  // 枝刈りを効率化するため、金額の降順にソート（大きいものから試す）
  const sortedCandidates = [...candidates]
    .map(c => ({...c, cents: toCents((c.expense || 0) - (c.income || 0))}))
    .filter(c => Math.abs(c.cents) <= Math.abs(targetCents)) // 同じ極性のみ、かつターゲット金額以下
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));

  const results: Transaction[][] = [];

  const backtrack = (
    startIndex: number,
    currentSum: number,
    currentCombination: Transaction[]
  ) => {
    // 成功条件
    if (currentSum === targetCents) {
      results.push([...currentCombination]);
      return;
    }
    // 失敗・枝刈り条件
    if (Math.abs(currentSum) > Math.abs(targetCents) || currentCombination.length >= maxDepth) {
      return;
    }

    for (let i = startIndex; i < sortedCandidates.length; i++) {
      const candidate = sortedCandidates[i];
      // Check sign (prevent mixing income and expenses in the same combination)
      if (Math.sign(candidate.cents) !== Math.sign(targetCents)) continue;

      const nextSum = currentSum + candidate.cents;

      // Look-ahead 枝刈り：次の要素を足してオーバーするならスキップ
      if (Math.abs(nextSum) > Math.abs(targetCents)) continue;

      currentCombination.push(candidate);
      backtrack(i + 1, nextSum, currentCombination);
      currentCombination.pop(); // バックトラック
    }
  };

  backtrack(0, 0, []);
  return results;
};

// 1対Nマッチングのエントリポイント
export const matchOneToMany = (
  targetAmt: number,
  targetTime: number,
  unmatchedCandidates: Transaction[],
  thresholdScore: number = 60
): { matchedIndices: number[], confidenceScore: number } | null => {
  const validCombinations = findSubsetSum(targetAmt, unmatchedCandidates, 5);

  if (validCombinations.length === 0) return null;

  let bestMatch = null;
  let highestScore = -Infinity;

  for (const combo of validCombinations) {
    const score = calculateConfidence(targetAmt, targetTime, combo);
    if (score > highestScore && score >= thresholdScore) {
      highestScore = score;
      bestMatch = combo;
    }
  }

  return bestMatch ? {
    matchedIndices: bestMatch.map(tx => tx.originalIndex ?? tx.index ?? -1),
    confidenceScore: highestScore
  } : null;
};

export function deduplicateBankRecords(bankRecords: Transaction[], reconciledRecords: Transaction[]) {
  const usedDbIndices = new Set<number>();
  const parseDate = (dstr: string) => new Date(dstr).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  return bankRecords.filter(b => {
    const bAmt = (b.expense || 0) - (b.income || 0);
    const bTime = parseDate(b.date);
    
    // First pass: 1-to-1 strict exact match
    let bestMatch = -1;
    let minDiff = Infinity;
    for (let j = 0; j < reconciledRecords.length; j++) {
       if (usedDbIndices.has(j)) continue;
       const a = reconciledRecords[j];
       const aAmt = (a.expense || 0) - (a.income || 0);
       const aTime = parseDate(a.date);
       if (Math.abs(bAmt - aAmt) < 0.01) {
          const daysDiff = Math.abs(bTime - aTime) / DAY_MS;
          if (daysDiff <= 3 && daysDiff < minDiff) { // strict date limit for 1-to-1
             minDiff = daysDiff;
             bestMatch = j;
          }
       }
    }
    
    if (bestMatch !== -1) {
       usedDbIndices.add(bestMatch);
       return false;
    }

    // Second pass: 1-to-N DP Branch and Bound
    const candidates: Transaction[] = [];
    for (let j = 0; j < reconciledRecords.length; j++) {
       if (usedDbIndices.has(j)) continue;
       const aTime = parseDate(reconciledRecords[j].date);
       if (Math.abs(bTime - aTime) / DAY_MS <= 14) {
          candidates.push({ ...reconciledRecords[j], originalIndex: j });
       }
    }
    
    const match = matchOneToMany(bAmt, bTime, candidates, 60);
    if (match) {
       match.matchedIndices.forEach((idx: number) => usedDbIndices.add(idx));
       return false;
    }
    
    return true; // Keep
  });
}

export type MatchGroup = {
  bankIndices: number[];
  appIndices: number[];
};

export function autoReconcile(bankRecords: Transaction[], appRecords: Transaction[]) {
  const matchedAppIndices = new Set<number>();
  const matchedBankIndices = new Set<number>();
  const matchGroups: MatchGroup[] = [];
  const parseDate = (dstr: string) => new Date(dstr).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  
  // Pass 1: 1-to-1 exact matches
  for (let i = 0; i < bankRecords.length; i++) {
    if (matchedBankIndices.has(i)) continue;
    const b = bankRecords[i];
    const bAmt = (b.expense || 0) - (b.income || 0);
    const bTime = parseDate(b.date);
    
    let bestMatch = -1;
    let minDiff = Infinity;
    
    for (let j = 0; j < appRecords.length; j++) {
      if (matchedAppIndices.has(appRecords[j].originalIndex ?? -1)) continue;
      const a = appRecords[j];
      const aAmt = (a.expense || 0) - (a.income || 0);
      const aTime = parseDate(a.date);
      
      if (Math.abs(bAmt - aAmt) < 0.01) {
        const daysDiff = Math.abs(bTime - aTime) / DAY_MS;
        if (daysDiff <= 3 && daysDiff < minDiff) { // strict 3 days
          minDiff = daysDiff;
          bestMatch = j;
        }
      }
    }
    if (bestMatch !== -1) {
      matchedBankIndices.add(i);
      matchedAppIndices.add(appRecords[bestMatch].originalIndex ?? -1);
      matchGroups.push({
        bankIndices: [i],
        appIndices: [appRecords[bestMatch].originalIndex ?? -1]
      });
    }
  }

  // Pass 2: 1-to-N matching (1 Bank to N App)
  for (let i = 0; i < bankRecords.length; i++) {
    if (matchedBankIndices.has(i)) continue;
    const b = bankRecords[i];
    const bAmt = (b.expense || 0) - (b.income || 0);
    const bTime = parseDate(b.date);
    
    const candidates: Transaction[] = [];
    for (let j = 0; j < appRecords.length; j++) {
       if (matchedAppIndices.has(appRecords[j].originalIndex ?? -1)) continue;
       const aTime = parseDate(appRecords[j].date);
       if (Math.abs(bTime - aTime) / DAY_MS <= 14) {
         candidates.push(appRecords[j]);
       }
    }
    
    const match = matchOneToMany(bAmt, bTime, candidates, 60);
    if (match) {
       matchedBankIndices.add(i);
       match.matchedIndices.forEach((idx: number) => matchedAppIndices.add(idx));
       matchGroups.push({
         bankIndices: [i],
         appIndices: match.matchedIndices
       });
    }
  }
  
  // Pass 3: N-to-1 matching (N Bank to 1 App)
  for (let j = 0; j < appRecords.length; j++) {
    const a = appRecords[j];
    if (matchedAppIndices.has(a.originalIndex ?? -1)) continue;
    const aAmt = (a.expense || 0) - (a.income || 0);
    const aTime = parseDate(a.date);
    
    const candidates: Transaction[] = [];
    for (let i = 0; i < bankRecords.length; i++) {
       if (matchedBankIndices.has(i)) continue;
       const bTime = parseDate(bankRecords[i].date);
       if (Math.abs(bTime - aTime) / DAY_MS <= 14) {
         candidates.push({ ...bankRecords[i], index: i });
       }
    }
    
    const match = matchOneToMany(aAmt, aTime, candidates, 60);
    if (match) {
       matchedAppIndices.add(a.originalIndex ?? -1);
       match.matchedIndices.forEach((idx: number) => matchedBankIndices.add(idx));
       matchGroups.push({
         bankIndices: match.matchedIndices,
         appIndices: [a.originalIndex ?? -1]
       });
    }
  }

  // Pass 4: 1-to-1 Fuzzy matches (for tips or foreign exchange differences)
  for (let i = 0; i < bankRecords.length; i++) {
    if (matchedBankIndices.has(i)) continue;
    const b = bankRecords[i];
    const bAmt = (b.expense || 0) - (b.income || 0);
    const bTime = parseDate(b.date);
    
    let bestMatch = -1;
    let minScore = Infinity; // We'll score by sum of percent difference and day difference
    
    for (let j = 0; j < appRecords.length; j++) {
      if (matchedAppIndices.has(appRecords[j].originalIndex ?? -1)) continue;
      const a = appRecords[j];
      const aAmt = (a.expense || 0) - (a.income || 0);
      const aTime = parseDate(a.date);
      
      const diffAmt = Math.abs(bAmt - aAmt);
      const percentDiff = diffAmt / Math.max(Math.abs(bAmt), 0.01);
      const daysDiff = Math.abs(bTime - aTime) / DAY_MS;
      
      // Allow up to 20% difference or flat $3.00 (tips/fx), within 3 days
      if ((percentDiff <= 0.20 || diffAmt <= 3.00) && daysDiff <= 3) {
        const score = percentDiff * 100 + daysDiff; // lower is better
        if (score < minScore) {
          minScore = score;
          bestMatch = j;
        }
      }
    }
    if (bestMatch !== -1) {
      matchedBankIndices.add(i);
      matchedAppIndices.add(appRecords[bestMatch].originalIndex ?? -1);
      matchGroups.push({
        bankIndices: [i],
        appIndices: [appRecords[bestMatch].originalIndex ?? -1]
      });
    }
  }

  return { matchedBankIndices, matchedAppIndices, matchGroups };
}

