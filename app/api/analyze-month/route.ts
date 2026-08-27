import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY が設定されていません。' }, { status: 400 });
    }
    
    const { month, expenses, budget, freeMoney, earmarkedMoney, totalSpent, isPastMonth, historicalDataText, daysPassed, totalDays, activeWishlist, detailedRecords } = await req.json();

    const ai = new GoogleGenAI({ apiKey });

    const wishlistText = activeWishlist && activeWishlist.length > 0
      ? `\n【現在購入を検討しているアイテム（使用検討中）】\n${activeWishlist.map((w: any) => `- ${w.name}: $${w.amount} (${w.category})`).join('\n')}\n\n※ユーザーは上記のアイテムを購入するか迷っています。全体の余裕資金やこれまでの支出ペースを踏まえ、「今月これらを買っても問題ないか、見送るべきか」をアドバイスしてください。その際、以下のルールを前提としてください：\n・他カテゴリが予算オーバーしても、「娯楽費」の黒字で吸収できているうちは問題ありません。\n・ただし、娯楽費で吸収しきれず「特別体験・イベント準備金（将来の大きな体験のための貯金）」を取り崩すシミュレーションになっている場合は、その購入に対して警告や見直しの提案を行ってください。`
      : '';

    const detailedRecordsText = detailedRecords && detailedRecords.length > 0
      ? `\n【対象月の具体的な購入明細（トランザクション）】\n${detailedRecords.map((r: any) => `- ${r.date} [${r.category}] ${r.description}: $${r.expense}`).join('\n')}\n\n※上記の明細を見て、「どの具体的な購入品が支出を圧迫している要因か」「見直すべき無駄遣いはないか」などを具体的に分析に含めてください。`
      : '';

    let promptText = '';
    
    if (isPastMonth) {
      promptText = `
あなたは私専属の優秀なファイナンシャルプランナーです。
過去の特定の月（${month}）の家計簿データを分析し、以下の点について具体的なアドバイスを300〜500文字程度で提供してください。
今回は「なぜ支出が高くなったのか（あるいは抑えられたのか）」の要因分析と、次月以降への改善アクションに焦点を当ててください。

【${month}の家計データ】
・月の経過日数: ${daysPassed || 30}日 / ${totalDays || 30}日 (完了)
・全体の変動費予算: $${budget}
・実際の変動費支出: $${totalSpent}
・純粋なフリー余裕資金: ${freeMoney > 0 ? `+$${freeMoney} (黒字)` : `-$${Math.abs(freeMoney)} (赤字)`}
・目的別積立の残高（衣服・自己投資）: $${earmarkedMoney}

【カテゴリ別支出内訳】
${expenses.map((e: any) => `- ${e.category}: $${e.spent} (予算: $${e.budget || 0})`).join('\n')}
${detailedRecordsText}

${historicalDataText ? `【全期間の過去支出履歴（比較・傾向分析用）】\n${historicalDataText}\n\n上記を踏まえ、過去の平均的な支出や季節的な傾向と比較して、この月（${month}）がどうだったかを必ず言及してください。` : ''}

上記を踏まえ、
1. 支出の主要な要因（どの項目が圧迫しているか、など）
2. 今後同じような月があった場合に気をつけるべき改善アクション
をプロの視点で分析してください。
`;
    } else {
      promptText = `
あなたは私専属の優秀なファイナンシャルプランナーです。
今月（${month}）のここまでの家計簿データを分析し、以下の点について具体的なアドバイスを300〜500文字程度で提供してください。

【今月の家計データ】
・月の経過日数: ${daysPassed || 1}日 / ${totalDays || 30}日 (${Math.round(((daysPassed || 1) / (totalDays || 30)) * 100)}%経過)
・全体の変動費予算: $${budget}
・現在の変動費支出: $${totalSpent}
・現在の純粋なフリー余裕資金: ${freeMoney > 0 ? `+$${freeMoney} (黒字)` : `-$${Math.abs(freeMoney)} (赤字)`}
・目的別積立の残高（衣服・自己投資等）: $${earmarkedMoney}
【カテゴリ別支出内訳】
${expenses.map((e: any) => `- ${e.category}: $${e.spent} (予算: $${e.budget || 0})`).join('\n')}
${detailedRecordsText}

${historicalDataText ? `【全期間の過去支出履歴（比較・傾向分析用）】\n${historicalDataText}\n\n上記を踏まえ、過去の平均的な支出や傾向と比較して、今月（${month}）のペースがどうなのか（いつもより使いすぎているか等）を必ず言及してください。` : ''}
${wishlistText}

上記を踏まえ、
1. 現状のペースに対する評価
2. 月の後半（または来月に向けて）の具体的なアクションプラン
をプロの視点でアドバイスしてください。
`;
    }
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: promptText,
    });

    return NextResponse.json({ success: true, advice: response.text });
  } catch (error) {
    console.error('AI Analysis Error:', error);
    return NextResponse.json({ success: false, message: 'AI分析中にエラーが発生しました。' }, { status: 500 });
  }
}
