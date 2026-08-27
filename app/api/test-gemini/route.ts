import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY が .env.local に設定されていません。' }, { status: 400 });
    }

    const { modelName } = await req.json();
    const modelToUse = modelName || 'gemini-3.6-flash';

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: `これはテスト通信です。「APIの通信は正常に成功しています！」と返答してください。`,
    });

    return NextResponse.json({ success: true, text: response.text });
  } catch (error: any) {
    console.error('Test API Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || String(error),
      fullError: error
    }, { status: 500 });
  }
}
