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
  let iterations = 0;
  const MAX_ITERATIONS = 10000;

  const backtrack = (
    startIndex: number,
    currentSum: number,
    currentCombination: Transaction[]
  ) => {
    if (iterations++ > MAX_ITERATIONS) return;

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
      if (iterations > MAX_ITERATIONS) break;
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
  const usedBankIndices = new Set<number>();
  const parseDate = (dstr: string) => new Date(dstr).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Pass 1: 1-to-1 strict exact match (including cross-sign: bank debit ↔ app income)
  for (let i = 0; i < bankRecords.length; i++) {
     if (usedBankIndices.has(i)) continue;
     const b = bankRecords[i];
     const bAmt = (b.expense || 0) - (b.income || 0);
     const bAbsAmt = Math.abs(bAmt);
     const bTime = parseDate(b.date);
     
     let bestMatch = -1;
     let minDiff = Infinity;
     let bestIsCrossSign = false;
     for (let j = 0; j < reconciledRecords.length; j++) {
        if (usedDbIndices.has(j)) continue;
        const a = reconciledRecords[j];
        const aAmt = (a.expense || 0) - (a.income || 0);
        const aAbsAmt = Math.abs(aAmt);
        const aTime = parseDate(a.date);
        const daysDiff = Math.abs(bTime - aTime) / DAY_MS;
        if (daysDiff > 3) continue;
        
        // Same-sign exact match
        if (Math.abs(bAmt - aAmt) < 0.01 && daysDiff < minDiff) {
           minDiff = daysDiff;
           bestMatch = j;
           bestIsCrossSign = false;
        }
        // Cross-sign match (bank debit ↔ app income)
        else if (Math.sign(bAmt) !== Math.sign(aAmt) && Math.abs(bAbsAmt - aAbsAmt) < 0.01 && daysDiff < minDiff) {
           if (bestMatch === -1 || bestIsCrossSign) {
             minDiff = daysDiff;
             bestMatch = j;
             bestIsCrossSign = true;
           }
        }
     }
     
     if (bestMatch !== -1) {
        usedDbIndices.add(bestMatch);
        usedBankIndices.add(i);
     }
  }

  // Pass 2: 1-to-N DP Branch and Bound
  for (let i = 0; i < bankRecords.length; i++) {
     if (usedBankIndices.has(i)) continue;
     const b = bankRecords[i];
     const bAmt = (b.expense || 0) - (b.income || 0);
     const bTime = parseDate(b.date);
     
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
        usedBankIndices.add(i);
     }
  }

  // Pass 3: N-to-1 matching (N Bank to 1 App)
  for (let j = 0; j < reconciledRecords.length; j++) {
     if (usedDbIndices.has(j)) continue;
     const a = reconciledRecords[j];
     const aAmt = (a.expense || 0) - (a.income || 0);
     const aTime = parseDate(a.date);
     
     const candidates: Transaction[] = [];
     for (let i = 0; i < bankRecords.length; i++) {
        if (usedBankIndices.has(i)) continue;
        const bTime = parseDate(bankRecords[i].date);
        if (Math.abs(bTime - aTime) / DAY_MS <= 14) {
           candidates.push({ ...bankRecords[i], index: i });
        }
     }
     
     const match = matchOneToMany(aAmt, aTime, candidates, 60);
     if (match) {
        usedDbIndices.add(j);
        match.matchedIndices.forEach((idx: number) => usedBankIndices.add(idx));
     }
  }

  // Pass 4: Fuzzy 1-to-1 (including cross-sign for deduplication)
  for (let i = 0; i < bankRecords.length; i++) {
    if (usedBankIndices.has(i)) continue;
    const b = bankRecords[i];
    const bAmt = (b.expense || 0) - (b.income || 0);
    const bAbsCents = Math.abs(toCents(bAmt));
    const bTime = parseDate(b.date);
    
    let bestMatch = -1;
    let minDiff = Infinity;
    
    for (let j = 0; j < reconciledRecords.length; j++) {
      if (usedDbIndices.has(j)) continue;
      const a = reconciledRecords[j];
      const aAmt = (a.expense || 0) - (a.income || 0);
      const aAbsCents = Math.abs(toCents(aAmt));
      const aTime = parseDate(a.date);
      
      // Compare absolute amounts (supports cross-sign)
      const diffCents = Math.abs(bAbsCents - aAbsCents);
      if (diffCents === 0) continue; // exact matches handled in Pass 1
      
      const isWithin300Cents = diffCents <= 300;
      const isWithin20Percent = diffCents <= bAbsCents * 0.2;
      
      if (isWithin300Cents || isWithin20Percent) {
        const daysDiff = Math.abs(bTime - aTime) / DAY_MS;
        if (daysDiff <= 3 && daysDiff < minDiff) {
          minDiff = daysDiff;
          bestMatch = j;
        }
      }
    }
    if (bestMatch !== -1) {
      usedDbIndices.add(bestMatch);
      usedBankIndices.add(i);
    }
  }

  return bankRecords.filter((_, i) => !usedBankIndices.has(i));
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
  
  // Pass 1: 1-to-1 exact matches (including cross-sign: bank debit ↔ app income)
  for (let i = 0; i < bankRecords.length; i++) {
    if (matchedBankIndices.has(i)) continue;
    const b = bankRecords[i];
    const bAmt = (b.expense || 0) - (b.income || 0);
    const bAbsAmt = Math.abs(bAmt);
    const bTime = parseDate(b.date);
    
    let bestMatch = -1;
    let minDiff = Infinity;
    let bestIsCrossSign = false;
    
    for (let j = 0; j < appRecords.length; j++) {
      const origIdx = appRecords[j].originalIndex;
      if (origIdx == null || matchedAppIndices.has(origIdx)) continue;
      const a = appRecords[j];
      const aAmt = (a.expense || 0) - (a.income || 0);
      const aAbsAmt = Math.abs(aAmt);
      const aTime = parseDate(a.date);
      
      const daysDiff = Math.abs(bTime - aTime) / DAY_MS;
      if (daysDiff > 3) continue;

      // Same-sign exact match (normal case)
      if (Math.abs(bAmt - aAmt) < 0.01 && daysDiff < minDiff) {
        minDiff = daysDiff;
        bestMatch = j;
        bestIsCrossSign = false;
      }
      // Cross-sign match: bank debit ↔ app income (e.g. Zelle payment matching advance_recovery)
      // Only match if absolute amounts are equal
      else if (Math.sign(bAmt) !== Math.sign(aAmt) && Math.abs(bAbsAmt - aAbsAmt) < 0.01 && daysDiff < minDiff) {
        // Prefer same-sign matches, so only use cross-sign if no same-sign found
        if (bestMatch === -1 || bestIsCrossSign) {
          minDiff = daysDiff;
          bestMatch = j;
          bestIsCrossSign = true;
        }
      }
    }
    if (bestMatch !== -1) {
      matchedBankIndices.add(i);
      const bestOrigIdx = appRecords[bestMatch].originalIndex;
      if (bestOrigIdx != null) {
        matchedAppIndices.add(bestOrigIdx);
        matchGroups.push({
          bankIndices: [i],
          appIndices: [bestOrigIdx]
        });
      }
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
      const origIdx = appRecords[j].originalIndex;
      if (origIdx == null || matchedAppIndices.has(origIdx)) continue;
      const a = appRecords[j];
      const aTime = parseDate(a.date);
      if (Math.abs(bTime - aTime) / DAY_MS <= 14) {
        candidates.push(a);
      }
    }
    
    if (candidates.length > 0) {
      const match = matchOneToMany(bAmt, bTime, candidates);
      if (match) {
        matchedBankIndices.add(i);
        const validMatchedIndices = match.matchedIndices.filter(idx => idx != null && idx !== -1);
        validMatchedIndices.forEach(idx => matchedAppIndices.add(idx));
        matchGroups.push({
          bankIndices: [i],
          appIndices: validMatchedIndices
        });
      }
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
  // Also supports cross-sign matching (bank debit ↔ app income)
  for (let i = 0; i < bankRecords.length; i++) {
    if (matchedBankIndices.has(i)) continue;
    const b = bankRecords[i];
    const bAmt = (b.expense || 0) - (b.income || 0);
    const bAbsAmt = Math.abs(bAmt);
    const bTime = parseDate(b.date);
    
    let bestMatch = -1;
    let minScore = Infinity; // We'll score by sum of percent difference and day difference
    
    for (let j = 0; j < appRecords.length; j++) {
      const origIdx = appRecords[j].originalIndex;
      if (origIdx == null || matchedAppIndices.has(origIdx)) continue;
      const a = appRecords[j];
      const aAmt = (a.expense || 0) - (a.income || 0);
      const aAbsAmt = Math.abs(aAmt);
      const aTime = parseDate(a.date);
      
      // Compare absolute amounts for both same-sign and cross-sign
      const diffAmt = Math.abs(bAbsAmt - aAbsAmt);
      const isCrossSign = Math.sign(bAmt) !== Math.sign(aAmt);
      
      const percentDiff = diffAmt / Math.max(bAbsAmt, 0.01);
      const daysDiff = Math.abs(bTime - aTime) / DAY_MS;
      
      // Allow up to 20% difference or flat $3.00 (tips/fx), within 3 days
      if ((percentDiff <= 0.20 || diffAmt <= 3.00) && daysDiff <= 3) {
        // Cross-sign matches get a small penalty to prefer same-sign
        const crossPenalty = isCrossSign ? 5 : 0;
        const score = percentDiff * 100 + daysDiff + crossPenalty; // lower is better
        if (score < minScore) {
          minScore = score;
          bestMatch = j;
        }
      }
    }
    if (bestMatch !== -1) {
      matchedBankIndices.add(i);
      const bestOrigIdx = appRecords[bestMatch].originalIndex;
      if (bestOrigIdx != null) {
        matchedAppIndices.add(bestOrigIdx);
        matchGroups.push({
          bankIndices: [i],
          appIndices: [bestOrigIdx]
        });
      }
    }
  }

  return { matchedBankIndices, matchedAppIndices, matchGroups };
}

