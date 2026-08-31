"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Transaction, AppData, WishlistItem, RecordType, MonthlySettings, ExpenseData, FixedExpense, AccountBalance, CategoryBudget, MonthlyData } from './types';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine
} from 'recharts';
import './globals.css';

const COLORS = ['#7dd3fc', '#38bdf8', '#86efac', '#34d399', '#f9a8d4', '#f472b6', '#a78bfa', '#c084fc'];

const DEFAULT_FIXED_EXPENSES = [
  { id: "1", name: "ホームステイ等、必要経費", amount: 0 },
  { id: "2", name: "娯楽費", amount: 0 },
  { id: "3", name: "生活品費", amount: 0 }
];


import { TripReconcileModal } from './components/modals/TripReconcileModal';
import { OffsetModal } from './components/modals/OffsetModal';
import { RawJsonEditorModal } from './components/modals/RawJsonEditorModal';
import { TransferModal } from './components/modals/TransferModal';
import { FixedExpensesModal } from './components/modals/FixedExpensesModal';
import { ExpenseModal } from './components/modals/ExpenseModal';
import { CsvReconcileModal } from './components/modals/CsvReconcileModal';
import { ExpensePieChart } from './components/charts/ExpensePieChart';
import { MonthlyBarChart } from './components/charts/MonthlyBarChart';

import { formatCurrency } from './lib/format';
import { useFinanceData } from './hooks/useFinanceData';
import { FinanceDataProvider, useFinanceContext } from './context/FinanceContext';
import { toCents, calculateConfidence, findSubsetSum, matchOneToMany, deduplicateBankRecords, autoReconcile } from './lib/reconcile';

const AIAdvice = ({ item, pool, freeMoney, savingsGoal }: any) => {
  const [advice, setAdvice] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let isMounted = true;
    const cacheKey = `ai_advice_${item.id}_${item.name}_${item.amount}_${item.category}_${pool}_${freeMoney}_${savingsGoal}`;
    
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setAdvice(cached);
        setLoading(false);
        return;
      }
    } catch (e) {
      // Ignore localStorage errors
    }

    setLoading(true);
    fetch('/api/simulate-wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemName: item.name, amount: item.amount, category: item.category, categoryRemaining: pool, freeMoney, savingsGoal
      })
    })
    .then(r => r.json())
    .then(data => {
      if (isMounted) {
        if (data.success) {
          setAdvice(data.advice);
          try {
            localStorage.setItem(cacheKey, data.advice);
          } catch (e) {}
        } else {
          setAdvice(data.message || '⚠️ AIサーバーが混雑しています。少し待ってからお試しください！');
        }
        setLoading(false);
      }
    })
    .catch(() => {
      if (isMounted) {
        setAdvice('⚠️ 通信エラーが発生しました。時間を置いて再度お試しください。');
        setLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, [item.id, item.name, item.amount, item.category, pool, freeMoney, savingsGoal]);

  if (loading) return <span>⏳ 🤖 AIがシミュレーション中...</span>;
  return <span>🤖 {advice}</span>;
};

export default function Page() {
  return (
    <FinanceDataProvider>
      <DashboardContent />
    </FinanceDataProvider>
  );
}

function DashboardContent() {
  const { data, loading, error, monthlySettings, localWishlist, setLocalWishlist, ignoredBudgetCategories, fetchData, addWishlist, toggleWishlist, deleteWishlist, updateWishlist, toggleIgnoredBudgetCategory, editRecord, deleteRecord, calculateAutoCover, executeAutoCover, exportData, importData } = useFinanceContext();
  const [mounted, setMounted] = useState(false);
  
  
  
  
  // Toggles
  const [hiddenCategories, setHiddenCategories] = useState<Record<string, boolean>>({ 'ホームステイ等、必要経費': true });
  // Modals
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; message: string; title?: string }>({ isOpen: false, message: '' });
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; message: string; title?: string; onConfirm: () => void; onCancel?: () => void; confirmText?: string; confirmColor?: string }>({ isOpen: false, message: '', onConfirm: () => {} });

  const showAlert = (message: string, title: string = 'お知らせ') => setAlertModal({ isOpen: true, message, title });
  const showConfirm = (message: string, onConfirm: () => void, title: string = '確認', confirmText: string = '実行', confirmColor: string = '#ef4444') => setConfirmModal({ isOpen: true, message, title, onConfirm, confirmText, confirmColor });
  const [showFixedModal, setShowFixedModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  // Forms
  const [expenseForm, setExpenseForm] = useState({ date: '', category: '', description: '', amount: '', recordType: 'expense_normal' });
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Monthly Settings State
  const [currentRealMonth, setCurrentRealMonth] = useState(''); // e.g. "2026-07"
  const [selectedMonth, setSelectedMonth] = useState(''); // User selected month for dashboard view
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);

  // Wishlist State
  
  const [wishlistForm, setWishlistForm] = useState({ name: '', amount: '', category: '' });
  const [editingWishlistId, setEditingWishlistId] = useState<string | null>(null);
  const [editingWishlistForm, setEditingWishlistForm] = useState({ name: '', amount: '', category: '' });
  const [wishlistIdToDeleteOnAdd, setWishlistIdToDeleteOnAdd] = useState<string | null>(null);

  // Ignored Budget Categories
  
  const [showCategorySettings, setShowCategorySettings] = useState(false);

  // Raw JSON Editor
  const [showRawEditor, setShowRawEditor] = useState(false);

  // Recent Activity Edit State
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState({ date: '', category: '', description: '', amount: '', isIncome: false });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmRecoveryId, setConfirmRecoveryId] = useState<string | null>(null);

  // New Engine State
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [showAnalysisReport, setShowAnalysisReport] = useState(false);
  const [deepAnalysis, setDeepAnalysis] = useState<string>('');
  const [isDeepAnalyzing, setIsDeepAnalyzing] = useState<boolean>(false);
  
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [csvRecords, setCsvRecords] = useState<Transaction[]>([]);
  const [showCsvModal, setShowCsvModal] = useState(false);
      
  const [isScrolled, setIsScrolled] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data?.expenseData && data.expenseData.length > 0 && !expenseForm.category) {
      setExpenseForm(prev => ({ ...prev, category: data.expenseData![0].name }));
    }

    if (data?.monthlyData) {
      const months = data.monthlyData.map((d: any) => d.name);
      if (currentRealMonth && !months.includes(currentRealMonth)) {
        months.push(currentRealMonth);
      }
      setAvailableMonths(Array.from(new Set(months)).sort().reverse());
    }
  }, [data?.expenseData, data?.monthlyData, expenseForm.category, currentRealMonth]);
;

  useEffect(() => {
    setMounted(true);
    // @ts-ignore
    window.showAlert = showAlert;
    // @ts-ignore
    window.showConfirm = showConfirm;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0].replace(/-/g, '/'); // YYYY/MM/DD
    const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
    
    setExpenseForm(prev => ({ ...prev, date: todayStr }));
    setCurrentRealMonth(monthStr);
    setSelectedMonth(monthStr);
    
    fetchData();

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 30);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setDeepAnalysis('');
  }, [selectedMonth]);



  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csv = event.target?.result;
      try {
        const res = await fetch('/api/finance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'import_csv', csv })
        });
        if (res.ok) {
          const resData = await res.json();
          let bankRecords = resData.records || [];
          
          // Filter CSV records to only include the current month, or the previous month (to allow for month-end boundary matches)
          const [currY, currM] = currentRealMonth.split('-');
          const currDate = new Date(parseInt(currY), parseInt(currM) - 1, 15); // middle of current month
          bankRecords = bankRecords.filter((r: Transaction) => {
            if (!r.date) return false;
            const rDate = new Date(r.date.replace(/\//g, '-'));
            const diffDays = Math.abs(rDate.getTime() - currDate.getTime()) / (1000 * 3600 * 24);
            return diffDays <= 45; // roughly within current or adjacent month
          });

          // Prepare App records
          const appRecords = (data?.records || []).map((r: Transaction, originalIndex: number) => ({ ...r, originalIndex }))
                                                .filter((r: Transaction) => !r.reconciled && (r.expense > 0 || r.income > 0));
                                                
                    // Deduplicate against already reconciled DB records to prevent double-importing
          const reconciledRecords = (data?.records || []).filter((r: Transaction) => r.reconciled);
          bankRecords = deduplicateBankRecords(bankRecords, reconciledRecords);
          
          if (bankRecords.length === 0) {
             showAlert('このCSVのデータはすべて取り込み済み・照合済みです。');
             return;
          }

          const { matchedBankIndices, matchedAppIndices } = autoReconcile(bankRecords, appRecords);
          
          if (matchedAppIndices.size > 0) {
             const matchedIds = Array.from(matchedAppIndices).map(idx => {
                const r = (data?.records || [])[idx];
                return r?.id;
             }).filter(Boolean);

             const batchRes = await fetch('/api/finance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'batch_reconcile',
                  payload: {
                    reconciledIds: matchedIds,
                    newRecords: []
                  }
                })
             });
             if (batchRes.ok) {
                // Update local data to reflect reconciled status
                await fetchData();
             }
          }
          
          const unmatchedBankRecords = bankRecords.filter((_: Transaction, idx: number) => !matchedBankIndices.has(idx));
          setCsvRecords(unmatchedBankRecords);
          setShowCsvModal(true);
          
          if (matchedBankIndices.size > 0) {
             showAlert(`🤖 🚀 ${matchedBankIndices.size}件のデータを自動照合しました。\n残りの${unmatchedBankRecords.length}件の不一致データを手動で確認してください。`);
          } else {
             showAlert('自動照合できるデータはありませんでした。手動で確認してください。');
          }
        }
      } catch (err) {
        showAlert('読み込みに失敗しました');
      }
    };
    reader.readAsText(file);
  };




  const handleAddWishlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wishlistForm.name || !wishlistForm.amount || !wishlistForm.category) return;
    try {
      await addWishlist({ name: wishlistForm.name, amount: wishlistForm.amount, category: wishlistForm.category, id: Date.now().toString() });
      setWishlistForm({ name: '', amount: '', category: '' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleWishlist = async (id: string, isApplied: boolean) => {
    setLocalWishlist(prev => prev.map(w => w.id === id ? { ...w, isApplied } : w));
    try {
      await toggleWishlist(id, isApplied);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteWishlist = async (id: string) => {
    try {
      await deleteWishlist(id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateWishlist = async (id: string) => {
    try {
      await updateWishlist(id, editingWishlistForm);
      setEditingWishlistId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleBuyWishlist = (w: WishlistItem) => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0].replace(/-/g, '/');
    setExpenseForm({ date: todayStr, category: w.category, description: w.name, amount: String(w.amount).toString(), recordType: 'expense_normal' });
    setWishlistIdToDeleteOnAdd(w.id);
    setShowExpenseModal(true);
  };

  const handleToggleIgnoredBudgetCategory = async (category: string, isIgnored: boolean) => {
    try {
      await toggleIgnoredBudgetCategory(category, isIgnored);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeepAnalysis = async () => {
    setIsDeepAnalyzing(true);
    try {
      const isPastMonth = selectedMonth < currentRealMonth;
      const variableCategoriesForAI = (data?.categoryBudgets || []).filter((c: any) => !(c.name || '').includes('必要経費') && !(c.name || '').includes('固定費'));
      
      const aiExpenses = variableCategoriesForAI.map((c: any) => ({
        category: c.name,
        spent: c.spent || 0,
        budget: c.pool || 0
      }));

      const aiTotalVarBudget = aiExpenses.reduce((acc: number, c: any) => acc + c.budget, 0);
      const aiTotalVarSpent = aiExpenses.reduce((acc: number, c: any) => acc + c.spent, 0);
      
      const aiEarmarkedCategories = variableCategoriesForAI.filter((c: any) => ['環境・自己投資', '衣服代'].includes(c.name || ''));
      const aiGeneralFreeCategories = variableCategoriesForAI.filter((c: any) => !['環境・自己投資', '衣服代'].includes(c.name || ''));
      
      const aiFreeMoney = aiGeneralFreeCategories.reduce((sum: number, c: any) => sum + (c.remaining || 0), 0);
      const aiEarmarkedMoney = aiEarmarkedCategories.reduce((sum: number, c: any) => sum + (c.remaining || 0), 0);
      
      // Generate historical data text for the AI
      let historicalDataText = '';
      if (data?.records && data.records.length > 0) {
        const monthlyHist: Record<string, Record<string, number>> = {};
        data.records.forEach((r: Transaction) => {
          if (r.month <= selectedMonth && r.expense > 0 && r.category) {
            // Exclude ignored categories and fixed/necessary expenses from the variable expense history
            const isIgnored = ignoredBudgetCategories.includes(r.category) || r.category.includes('固定') || r.category.includes('必要経費');
            if (!isIgnored && (r.recordType === 'expense_normal' || r.recordType === 'advance_recovery')) {
              if (!monthlyHist[r.month]) monthlyHist[r.month] = {};
              monthlyHist[r.month][r.category] = (monthlyHist[r.month][r.category] || 0) + r.expense;
            }
          }
        });
        
        // Sort months descending, take up to 12 months for context
        const sortedMonths = Object.keys(monthlyHist).sort().reverse().slice(0, 12);
        historicalDataText = sortedMonths.map(m => {
          const cats = Object.entries(monthlyHist[m])
            .sort((a, b) => b[1] - a[1]) // highest first
            .map(([cat, amt]) => `${cat}: $${amt.toFixed(2)}`)
            .join(', ');
          return `【${m}】\n${cats}`;
        }).join('\n\n');
      }

      let daysPassed = 0;
      let totalDays = 30;
      try {
        const [y, m] = selectedMonth.split('-').map(Number);
        totalDays = new Date(y, m, 0).getDate();
        if (isPastMonth) {
          daysPassed = totalDays;
        } else if (selectedMonth === currentRealMonth) {
          daysPassed = new Date().getDate();
        }
      } catch (e) {}

      const activeWishlist = localWishlist.filter(w => w.isApplied);

      const detailedRecords = data?.records?.filter((r: Transaction) => 
        r.month === selectedMonth && 
        r.expense > 0 && 
        !ignoredBudgetCategories.includes(r.category) && 
        !r.category.includes('固定') && 
        !r.category.includes('必要経費') &&
        (r.recordType === 'expense_normal' || r.recordType === 'advance_recovery' || !r.recordType)
      ).map((r: Transaction) => ({
        date: r.date,
        category: r.category,
        description: r.description,
        expense: r.expense
      })) || [];

      const res = await fetch('/api/analyze-month', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          expenses: aiExpenses,
          budget: aiTotalVarBudget,
          freeMoney: aiFreeMoney,
          earmarkedMoney: aiEarmarkedMoney,
          totalSpent: aiTotalVarSpent,
          isPastMonth,
          historicalDataText,
          daysPassed,
          totalDays,
          activeWishlist,
          detailedRecords
        })
      });
      const resData = await res.json();
      if (resData.success) {
        setDeepAnalysis(resData.advice);
      } else {
        setDeepAnalysis(resData.message || '⚠️ 分析に失敗しました。');
      }
    } catch (e) {
      setDeepAnalysis('⚠️ 通信エラーが発生しました。');
    }
    setIsDeepAnalyzing(false);
  };

  const handleEditRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRecordId !== null) {
      const payload = {
        date: editFormData.date,
        category: editFormData.category,
        description: editFormData.description,
        expense: editFormData.isIncome ? 0 : parseFloat(editFormData.amount),
        income: editFormData.isIncome ? parseFloat(editFormData.amount) : 0
      };
      await editRecord(editingRecordId, payload);
      showAlert('編集内容を保存しました！');
      setEditingRecordId(null);
    }
  };

  const handleDeleteRecord = async (id: string) => {
    try {
      await deleteRecord(id);
      setConfirmDeleteId(null);
    } catch (err) {
      showAlert('エラーが発生しました');
    }
  };


  const handleAutoCoverTransportation = async (neededAmount: number) => {
    try {
      const transfers = calculateAutoCover(neededAmount, 'ガソリン交通費');
      const details = transfers.map((t: any) => `・${t.from} から $${t.amount.toFixed(2)}`).join('\n');
      
      showConfirm(
        `交通費の自動補填を実行しますか？\n\n${details}`,
        async () => {
          try {
            await executeAutoCover(transfers, currentRealMonth);
            showAlert('交通費の自動補填が完了しました！');
          } catch (e: any) {
            showAlert(e.message || 'エラーが発生しました。');
          }
        },
        '自動補填の確認',
        '補填する',
        'var(--accent-color)'
      );
    } catch (e: any) {
      showAlert(e.message || 'エラーが発生しました。');
    }
  };;

  const handleExportData = async () => {
    try {
      await exportData();
    } catch (err: any) {
      showAlert(err.message || 'バックアップの作成に失敗しました。');
      console.error(err);
    }
  };

  const handleImportData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importData(file);
      showAlert('データを復元しました。');
    } catch (err: any) {
      showAlert(err.message || 'リストアに失敗しました。');
      console.error(err);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };;

  const handleEditRecord = (record: Transaction) => {
    if (record.id) {
      setEditingRecordId(record.id);
      setEditFormData({
        date: record.date,
        category: record.category,
        description: record.description || '',
        amount: String(record.expense > 0 ? record.expense : record.income),
        isIncome: record.income > 0
      });
    }
  };

  const openGemini = () => {
    if (!data) return;
    const { summary, accountBalances, expenseData, monthlySettings } = data;
    const mainAcc = accountBalances?.find((a: AccountBalance) => a.id === 'main')?.balance || 0;
    const saveAcc = accountBalances?.find((a: AccountBalance) => a.id === 'savings')?.total || 0;
    const futureExp = accountBalances?.find((a: AccountBalance) => a.id === 'future_expenses')?.balance || 0;
    
    const detailedExpenses = expenseData.map((item: ExpenseData) => `- ${item.name}: $${parseFloat(String(item.value)).toFixed(2)}`).join('\n');
    const futureSettings = Object.keys(monthlySettings)
      .filter(m => m >= currentRealMonth)
      .map(m => {
        const s = monthlySettings[m];
        const fixed = s.fixedExpenses.map((f: FixedExpense) => `${f.name}($${parseFloat(String(f.amount || 0)).toFixed(2)})`).join(', ');
        return `[${m}] 固定費: ${fixed} / 貯金目標: $${parseFloat(String(s.savingsGoal || 0)).toFixed(2)}`;
      }).join('\n');

    const promptText = `
あなたは私専属の優秀なファイナンシャルプランナーです。以下の詳細な家計簿データ（全カテゴリの支出、今後の固定費予定など）を深く分析し、
1. 現在の支出傾向の具体的な分析（具体的にどの項目にどれくらい使っているかを踏まえて）
2. 今後の固定費と貯金目標を達成・維持するための実践的で具体的なアドバイス
3. モチベーションが上がるようなポジティブな締めくくり
の3点を、600文字〜800文字程度のしっかりとした日本語で回答してください。

【口座データ】
現在の全体の総残高: $${parseFloat(String(summary.currentBalance || 0)).toFixed(2)}
メイン口座 (将来の予定をすべて引いた安心残高): $${parseFloat(String(mainAcc || 0)).toFixed(2)}
貯金口座 (これまでのストック＋今後の予定): $${parseFloat(String(saveAcc || 0)).toFixed(2)}
今後の固定費引き落とし予定合計: $${parseFloat(String(futureExp || 0)).toFixed(2)}

【これまでのカテゴリ別全支出内訳】
${detailedExpenses}

【今後の月別予算設定（固定費と貯金目標）】
${futureSettings}
`;
    navigator.clipboard.writeText(promptText).then(() => {
      showAlert("現在の詳細な家計簿データをクリップボードにコピーしました！\n\n開いた画面（Gemini）の入力欄に貼り付け（Ctrl+V）して送信してください。");
      window.open('https://gemini.google.com/app', 'GeminiPopup', 'width=800,height=800,scrollbars=yes,resizable=yes');
    }).catch(err => {
      showAlert("クリップボードへのコピーに失敗しました。");
    });
  };


  const summary = data?.summary || ({} as any);
  const originalExpenseData = data?.expenseData || [];
  const monthlyData = data?.monthlyData || [];
  const accountBalances = data?.accountBalances || [];
  const formatCurrency = (val: number) => loading ? '---' : `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // --- Dynamic Pie Chart Data Calculation ---
  const targetMonth = selectedMonth;
  const { generatedPieData, uniqueCategories } = React.useMemo(() => {
    const pieExpensesByCategory: Record<string, number> = {};
    if (data?.records) {
      data.records.forEach((row: Transaction) => {
        const expense = (row.expense) || 0;
        const category = row.category || 'その他';
        const month = row.month;
        const recordType = row.recordType || 'expense_normal';
        const isExcludedExpense = recordType === 'advance_payment';
        
        if (expense !== 0 && category !== '入金' && !isExcludedExpense) {
          if (!targetMonth || month === targetMonth) {
             if (!ignoredBudgetCategories.includes(category)) {
               pieExpensesByCategory[category] = (pieExpensesByCategory[category] || 0) + expense;
             }
          }
        }
      });
    }

    const genPieData = Object.keys(pieExpensesByCategory).map(key => ({
      name: key,
      value: pieExpensesByCategory[key]
    })).sort((a, b) => b.value - a.value);

    const currentFixedExpenses = data?.monthlySettings?.[currentRealMonth]?.fixedExpenses;
    const budgetCategoryNames = currentFixedExpenses
      ? currentFixedExpenses.map((f: any) => f.name)
      : [];
    const uCategories = Array.from(new Set([
      '特別体験・イベント費',
      ...budgetCategoryNames,
      ...(genPieData.map(item => item.name))
    ]));
    return { generatedPieData: genPieData, uniqueCategories: uCategories };
  }, [data?.records, data?.monthlySettings, currentRealMonth, targetMonth, ignoredBudgetCategories]);

  const visibleExpenseData = React.useMemo(() => {
    return generatedPieData.filter((item) => !hiddenCategories[item.name]);
  }, [generatedPieData, hiddenCategories]);
  
  const categoryBudgets = data?.categoryBudgets || [];
  const eventWishlistDeductions = localWishlist.filter(w => w.isApplied && w.category === 'イベント準備金').reduce((sum, w) => sum + parseFloat(String(w.amount || 0)), 0);
  const variableWishlistDeductions = localWishlist.filter(w => w.isApplied && w.category !== 'イベント準備金').reduce((sum, w) => sum + parseFloat(String(w.amount || 0)), 0);
  
  let wishlistOverflowAmount = 0;
  let entertainmentRemainingForCover = 0;
  
  categoryBudgets.forEach((cat: CategoryBudget) => {
    if (cat.name === '特別体験・イベント費') return;
    if (cat.name === '娯楽費') return; // Handled separately
    const wishlistForCat = localWishlist.filter(w => w.isApplied && w.category === cat.name).reduce((sum, w) => sum + parseFloat(String(w.amount || 0)), 0);
    const realRemaining = cat.remaining || 0;
    if (wishlistForCat > 0) {
      if (realRemaining >= 0 && wishlistForCat > realRemaining) {
        wishlistOverflowAmount += (wishlistForCat - realRemaining);
      } else if (realRemaining < 0) {
        wishlistOverflowAmount += wishlistForCat;
      }
    }
  });

  const entCat = categoryBudgets.find((c: CategoryBudget) => c.name === '娯楽費');
  if (entCat) {
    const entWishlist = localWishlist.filter(w => w.isApplied && w.category === '娯楽費').reduce((sum, w) => sum + parseFloat(String(w.amount || 0)), 0);
    const entRealRemaining = entCat.remaining || 0;
    
    if (entWishlist > 0 && entRealRemaining >= 0 && entWishlist > entRealRemaining) {
      wishlistOverflowAmount += (entWishlist - entRealRemaining);
    } else if (entWishlist > 0 && entRealRemaining < 0) {
      wishlistOverflowAmount += entWishlist;
    } else {
      entertainmentRemainingForCover = Math.max(0, entRealRemaining - entWishlist);
    }
  }

  let entertainmentCovered = 0;
  let eventFundCovered = 0;
  if (wishlistOverflowAmount > 0) {
    if (entertainmentRemainingForCover >= wishlistOverflowAmount) {
      entertainmentCovered = wishlistOverflowAmount;
    } else {
      entertainmentCovered = entertainmentRemainingForCover;
      eventFundCovered = wishlistOverflowAmount - entertainmentCovered;
    }
  }
  
  const savingsAccount = accountBalances?.find((a: AccountBalance) => a.id === 'savings');
  const mainAccount = accountBalances?.find((a: AccountBalance) => a.id === 'main');

  const variableCategories = categoryBudgets.filter((c: CategoryBudget) => !(c.name || '').includes('必要経費') && !(c.name || '').includes('固定費'));
  const fixedCategories = categoryBudgets.filter((c: CategoryBudget) => (c.name || '').includes('必要経費') || (c.name || '').includes('固定費'));
  const fixedDeficits = fixedCategories.reduce((sum: number, c: CategoryBudget) => sum + Math.abs(Math.min(0, c.remaining || 0)), 0);
  
  eventFundCovered += fixedDeficits; // User requested: 固定費の赤字はイベント費から引く

  const earmarkedCategories = variableCategories.filter((c: CategoryBudget) => ['環境・自己投資', '衣服代'].includes(c.name || ''));
  const generalFreeCategories = variableCategories.filter((c: CategoryBudget) => !['環境・自己投資', '衣服代'].includes(c.name || ''));

  const variableFreeMoney = generalFreeCategories.reduce((sum: number, c: CategoryBudget) => sum + (c.remaining || 0), 0);
  const earmarkedMoney = earmarkedCategories.reduce((sum: number, c: CategoryBudget) => sum + (c.remaining || 0), 0);

  const unrecoveredAdvances = (data?.records || []).filter((r: any) => r.recordType === 'advance_payment' && !r.description?.includes('（回収済）'));

  // Calculate Target Review Month Data
  const todayForLastMonth = new Date();
  let lastM = todayForLastMonth.getMonth(); // 0-11
  let lastY = todayForLastMonth.getFullYear();
  if (lastM === 0) {
    lastM = 12;
    lastY -= 1;
  }
  const lastMonthStr = `${lastY}-${String(lastM).padStart(2, '0')}`;
  
  const targetReviewMonth = (selectedMonth && selectedMonth !== currentRealMonth) ? selectedMonth : lastMonthStr;
  
  const targetReviewData = monthlyData?.find((d: MonthlyData) => d.name === targetReviewMonth);
  const targetReviewSpent = targetReviewData ? (targetReviewData['支出'] || 0) : 0;
  const targetReviewSettings = data?.monthlySettings?.[targetReviewMonth] || { fixedExpenses: [] };
  const targetReviewBudget = targetReviewSettings.fixedExpenses?.reduce((sum: number, f: FixedExpense) => sum + (parseFloat(String(f.amount)) || 0), 0) || 0;

  return (
    <div className="dashboard-container">
      <header className={`main-header ${isScrolled ? 'scrolled' : ''}`}>
        <div className="header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: '10px' }}>
          <div className="header-title-container" style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: '1 1 auto', minWidth: 0 }}>
            <h1 className="header-title" style={{ margin: 0, wordBreak: 'break-word', lineHeight: 1.1, paddingBottom: '0.2em', fontFamily: 'var(--font-dancing-script), cursive', fontSize: '3rem', fontWeight: 700, letterSpacing: '1px' }}>
              Smart Money <br className="mobile-break" />Manager
            </h1>
          </div>
          <div className="header-buttons" style={{ display: 'flex', gap: '6px', flexWrap: 'nowrap', flexShrink: 0 }}>
            <button className="action-button" onClick={() => setShowExpenseModal(true)} style={{ padding: '0.5rem 0.8rem', fontSize: '0.85rem', whiteSpace: 'nowrap', background: '#bae6fd', color: '#0369a1', border: '1px solid #7dd3fc' }}>
              ＋ 支出を追加
            </button>
            <button className="action-button secondary" onClick={() => fileInputRef.current?.click()} style={{ padding: '0.5rem 0.8rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }} title="銀行のCSVデータを読み込み、手入力したデータと自動で突き合わせます。一致したものは自動処理され、ズレがあるものだけ画面で確認・調整できます。">
              CSV照合
            </button>
            <button className="action-button secondary" onClick={() => setShowFixedModal(true)} style={{ padding: '0.5rem 0.8rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
              予算・固定費
            </button>
          </div>
        </div>
        <p className="header-subtitle" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          <span style={{ fontStyle: 'italic', color: 'var(--accent-color)', fontWeight: 600 }}>Design your wealth, guided by AI.</span>
          <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
          過去から学び、未来の体験を創り出す。
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '10px' }}>v1.0.65</span>
        </p>
      </header>

      <section className="stats-grid">
        <div className="glass-card highlight" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.7), rgba(99, 102, 241, 0.15))', borderColor: '#6366f1' }}>
          <div className="stat-title">全体の総残高</div>
          <div className="stat-value" style={{ color: '#6366f1' }}>{formatCurrency(summary?.currentBalance || 0)}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
            ※現在の純粋な手持ち資産合計
          </div>
        </div>
        
        <div className="glass-card highlight" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.7), rgba(125, 211, 252, 0.2))', borderColor: 'var(--accent-color)' }}>
          <div className="stat-title">今月自由に使えるお金</div>
          <div className="stat-value" style={{ color: 'var(--accent-color)' }}>{formatCurrency(variableFreeMoney)}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
            ※衣服・自己投資等の目的別積立を除く、フリー予算の合計
          </div>
          {earmarkedMoney > 0 && (
            <div style={{ fontSize: '0.85rem', color: '#0369a1', marginTop: '8px', padding: '4px 8px', background: 'rgba(255,255,255,0.6)', borderRadius: '6px' }}>
              👔 衣服・自己投資用の積立残高: {formatCurrency(earmarkedMoney)}
            </div>
          )}
          {variableWishlistDeductions > 0 && (
            <div style={{ fontSize: '0.9rem', color: '#d97706', marginTop: '10px', fontWeight: 'bold' }}>
              使用検討中の合計: {formatCurrency(variableWishlistDeductions)}
              <div style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-secondary)' }}>
                （検討額を引いた実質残り: {formatCurrency(variableFreeMoney - variableWishlistDeductions)}）
              </div>
            </div>
          )}
          
          <div style={{ marginTop: '1.2rem', textAlign: 'center' }}>
            <button 
              className="action-button secondary" 
              onClick={() => setShowTransferModal(true)}
              style={{ fontSize: '0.85rem', padding: '0.4rem 1rem', background: 'rgba(255,255,255,0.7)', border: '1px solid var(--accent-color)', color: 'var(--accent-color)' }}
            >
              🚚 今月の予算を移動する
            </button>
          </div>
        </div>

        <div className="glass-card highlight" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.7), rgba(245, 158, 11, 0.15))', borderColor: '#f59e0b' }}>
          {(() => {
            const eventBonus = categoryBudgets.find((c: CategoryBudget) => c.name === '特別体験・イベント費')?.transferredIn || 0;
            const totalBucket = (savingsAccount?.total || 0) + (mainAccount?.balance || 0) + eventBonus;
            return (
              <>
                <div className="stat-title">🚀 特別体験・イベント準備金 (体験投資バケツ)</div>
                <div className="stat-value" style={{ color: '#d97706' }}>{formatCurrency(totalBucket)}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
                  ※目標積立 ＋ 節約トレードオフ報酬 ＋ 仕送り余白（余剰金）の全合流プール
                  <br />
                  <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                    （予算設定の最終月である <strong>{
                      (() => {
                        const configuredMonths = Object.keys(data?.monthlySettings || {}).sort();
                        return configuredMonths.length > 0 ? configuredMonths[configuredMonths.length - 1] : currentRealMonth;
                      })()
                    }</strong> までに積み立つ予定の総額）
                  </span>
                </div>
                
                {eventBonus > 0 && (
                  <div style={{ fontSize: '0.9rem', color: '#b45309', marginTop: '12px', fontWeight: 'bold', padding: '0.5rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
                    💡 今月の賢いトレードオフ（節約・自制）によって生み出された追加移管ボーナス: +{formatCurrency(eventBonus)}
                  </div>
                )}

                {eventWishlistDeductions > 0 && (
                  <div style={{ fontSize: '0.9rem', color: '#d97706', marginTop: '10px', fontWeight: 'bold' }}>
                    イベント準備検討額: {formatCurrency(eventWishlistDeductions)}
                    <div style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-secondary)' }}>
                      （検討額を引いた実質残り: {formatCurrency(totalBucket - eventWishlistDeductions)}）
                    </div>
                  </div>
                )}

                {eventFundCovered > 0 && (
                  <div style={{ fontSize: '0.9rem', color: '#ec4899', marginTop: '10px', fontWeight: 'bold' }}>
                    予算オーバー（固定費・予測分含む）補填予測: -{formatCurrency(eventFundCovered)}
                    <div style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-secondary)' }}>
                      （補填後の最終実質残り: {formatCurrency(totalBucket - eventWishlistDeductions - eventFundCovered)}）
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {summary?.unrecoveredAdvance > 0 && (
          <div className="glass-card highlight" style={{ background: '#fef2f2', borderColor: '#ef4444' }}>
            <div className="stat-title" style={{ color: '#ef4444' }}>🤝 未回収の立替金</div>
            <div className="stat-value" style={{ color: '#ef4444' }}>{formatCurrency(summary.unrecoveredAdvance)}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '5px', marginBottom: '10px' }}>
              ※友人の代わりに支払った金額。総資産からは減っていますが, 月々の予算グラフには影響しません。回収したら各項目の「✓ 回収」を押してください。
            </div>
            {unrecoveredAdvances.length > 0 && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {unrecoveredAdvances.map((adv: any) => (
                  <div key={adv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.8)', padding: '8px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                    <div style={{ fontSize: '0.85rem', color: '#7f1d1d' }}>
                      <span style={{ fontWeight: 'bold' }}>{adv.date}</span> - {adv.description} <br/>
                      <span style={{ fontWeight: 'bold' }}>{formatCurrency(parseFloat(adv.expense) || 0)}</span>
                    </div>
                    <div>
                      {confirmRecoveryId === adv.id ? (
                        <button 
                          onClick={async () => {
                            setConfirmRecoveryId(null);
                            const payload = {
                              date: new Date().toISOString().split('T')[0].replace(/-/g, '/'),
                              category: '入金',
                              description: `${adv.description} (立替回収)`,
                              amount: parseFloat(adv.expense) || 0,
                              recordType: 'advance_recovery'
                            };
                            await fetch('/api/finance', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'add_expense', payload })
                            });
                            await fetch('/api/finance', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'edit_record', payload: { id: adv.id, ...adv, description: adv.description ? `${adv.description} （回収済）` : '（回収済）' } })
                            });
                            fetchData();
                          }}
                          className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', background: '#16a34a', color: 'white', borderColor: '#16a34a', whiteSpace: 'nowrap' }}
                        >
                          回収する
                        </button>
                      ) : (
                        <button 
                          onClick={() => setConfirmRecoveryId(adv.id ?? null)}
                          className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', background: '#dcfce3', color: '#166534', borderColor: '#bbf7d0', whiteSpace: 'nowrap' }}
                        >
                          ✓ 回収
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {summary?.unsettledTripSandbox > 0 && (
          <div className="glass-card highlight" style={{ background: 'linear-gradient(135deg, rgba(255, 251, 235, 0.9), rgba(254, 243, 199, 0.8))', borderColor: '#f59e0b' }}>
            <div className="stat-title" style={{ color: '#d97706' }}>🎒 旅行プール一時保留中 (未清算)</div>
            <div className="stat-value" style={{ color: '#d97706' }}>{formatCurrency(summary.unsettledTripSandbox)}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
              ※旅行やイベントの支払いとして一時隔離中です。精算額が確定したら一括精算してください。
            </div>
            <div style={{ marginTop: '1.2rem', textAlign: 'center' }}>
              <button 
                className="action-button primary" 
                onClick={() => setShowReconcileModal(true)}
                style={{ fontSize: '0.9rem', padding: '0.5rem 1.5rem', background: '#f59e0b' }}
              >
                🎒 ワンクリック一括精算 (Trip Reconcile)
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="glass-card" style={{ marginTop: '2rem' }}>
        <h2 className="chart-title">カテゴリ別 予算と支出 (今月)</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {categoryBudgets.map((cat: any) => {
            const wishlistForCat = localWishlist.filter(w => w.isApplied && w.category === cat.name).reduce((sum, w) => sum + parseFloat(String(w.amount || 0)), 0);
            const realRemaining = cat.remaining || 0;
            const isBudgetActive = cat.originalBudget > 0 || cat.carriedOver > 0 || cat.transferredIn > 0;
            
            const usedProgress = isBudgetActive && cat.budget > 0 ? (cat.spent / cat.budget) * 100 : (cat.spent > 0 ? 100 : 0);
            const wishProgress = isBudgetActive && cat.budget > 0 ? (wishlistForCat / cat.budget) * 100 : 0;
            
            const barColor = isBudgetActive ? (usedProgress > 100 ? '#ef4444' : usedProgress > 80 ? '#f59e0b' : 'var(--success-color)') : '#cbd5e1';
            const coverProgress = isBudgetActive && cat.budget > 0 && cat.name === '娯楽費' ? (entertainmentCovered / cat.budget) * 100 : 0;
            const totalSimulatedProgress = usedProgress + wishProgress + coverProgress;
            
            return (
              <div key={cat.name} style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <div className="category-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{cat.name}</div>
                  <div className="budget-details">
                    {isBudgetActive ? (
                      <>
                        <span style={{ color: 'var(--text-primary)' }}>
                          実質プール: <span style={{ fontWeight: 'bold' }}>{formatCurrency(cat.budget)}</span>
                          <span style={{ fontSize: '0.85rem', marginLeft: '4px', color: cat.carriedOver > 0 ? 'var(--success-color)' : cat.carriedOver < 0 ? '#ef4444' : 'var(--text-secondary)' }}>
                            (当月: {formatCurrency(cat.originalBudget)} + 繰越: {formatCurrency(cat.carriedOver)} 
                            {cat.rule?.maxPoolCap ? ` / 上限: ${formatCurrency(cat.rule.maxPoolCap)}` : ''})
                          </span>
                        </span>
                        {cat.isCapped && (
                          <span style={{ display: 'inline-block', marginLeft: '8px', padding: '2px 6px', background: '#e0f2fe', color: '#0369a1', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>MAX到達</span>
                        )}
                        <span className="separator" style={{ color: '#cbd5e1', margin: '0 6px' }}>|</span>
                        <span style={{ color: '#0284c7' }}>使用: <span style={{ fontWeight: 'bold' }}>{formatCurrency(cat.spent)}</span></span>
                        <span className="separator" style={{ color: '#cbd5e1', margin: '0 6px' }}>|</span>
                        <span style={{ color: realRemaining < 0 ? '#ef4444' : 'var(--success-color)', fontWeight: 'bold' }}>
                          残り: {formatCurrency(realRemaining)}
                        </span>
                        {wishlistForCat > 0 && (
                          <>
                            <span className="separator" style={{ color: '#cbd5e1', margin: '0 6px' }}>|</span>
                            <span style={{ color: wishlistForCat > realRemaining ? '#ec4899' : '#d97706', fontWeight: 'bold' }}>
                              使用検討{wishlistForCat > realRemaining ? '(予測オーバー)' : ''}: {formatCurrency(wishlistForCat)}
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span style={{ color: 'var(--text-primary)' }}>予算: 設定なし</span>
                        <span className="separator" style={{ color: '#cbd5e1', margin: '0 6px' }}>|</span>
                        <span style={{ color: '#0284c7' }}>使用: <span style={{ fontWeight: 'bold' }}>{formatCurrency(cat.spent)}</span></span>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', display: 'flex' }}>
                  <div style={{ 
                    height: '100%', 
                    background: barColor, 
                    width: `${Math.min(usedProgress, 100)}%`,
                    transition: 'width 0.3s ease'
                  }}></div>
                  {wishlistForCat > 0 && (
                    <div style={{
                      height: '100%',
                      background: wishlistForCat > realRemaining ? '#fbcfe8' : '#fcd34d',
                      opacity: 0.9,
                      width: `${Math.min(wishProgress, 100 - Math.min(usedProgress, 100))}%`,
                      transition: 'width 0.3s ease'
                    }}></div>
                  )}
                  {coverProgress > 0 && (
                    <div style={{
                      height: '100%',
                      background: '#fdba74',
                      opacity: 0.9,
                      width: `${Math.min(coverProgress, 100 - Math.min(usedProgress + wishProgress, 100))}%`,
                      transition: 'width 0.3s ease'
                    }}></div>
                  )}
                </div>
                {cat.futureReserved > 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem', textAlign: 'right' }}>
                    ※来月以降のためのキープ額: {formatCurrency(cat.futureReserved)}
                  </div>
                )}
                {cat.name === '娯楽費' && entertainmentCovered > 0 && (
                  <div style={{ fontSize: '0.9rem', color: '#f97316', marginTop: '10px', fontWeight: 'bold' }}>
                    他カテゴリの予算オーバー補填予測: -{formatCurrency(entertainmentCovered)}
                    <div style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-secondary)' }}>
                      （補填後の最終実質残り: {formatCurrency(Math.max(0, realRemaining - wishlistForCat - entertainmentCovered))}）
                    </div>
                  </div>
                )}
                {cat.isCapped && cat.name === '環境・自己投資' && (
                  <div style={{ fontSize: '0.85rem', color: '#0284c7', marginTop: '0.5rem' }}>
                    💡 サジェスト: 予算が上限に達しています。期待値の高い自己投資を実行してください！
                  </div>
                )}
                {cat.name === 'ガソリン交通費' && realRemaining < 0 && (
                  <div style={{ marginTop: '0.8rem', background: '#fff1f2', padding: '0.8rem', borderRadius: '8px', border: '1px solid #fecdd3' }}>
                    <p style={{ color: '#be123c', fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                      ⚠️ 交通費がオーバーしています！実需の移動をカバーするため, 予算を自動補填しますか？
                    </p>
                    <button 
                      onClick={() => handleAutoCoverTransportation(Math.abs(realRemaining))}
                      className="action-button primary"
                      style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem', width: 'auto' }}
                    >
                      🚗 スマートに自動補填する (娯楽費・イベント費から)
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="glass-card" style={{ marginTop: '2rem' }}>
        <h2 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>🛒 買いたいものシミュレーション</span>
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          今月買いたいものをリストアップ！チェックを入れると, 上の「メイン口座」と「カテゴリの残り予算」から一時的に引かれて, 買っても大丈夫かシミュレーションできます。
        </p>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '1.5rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <input type="text" placeholder="買いたいもの (例: 新しい靴)" value={wishlistForm.name} onChange={e => setWishlistForm({...wishlistForm, name: e.target.value})} style={{ flex: '1 1 200px', padding: '0.75rem', borderRadius: '12px', border: '1px solid #cbd5e1' }} />
          <input type="number" step="0.01" placeholder="金額 $" value={wishlistForm.amount} onChange={e => setWishlistForm({...wishlistForm, amount: e.target.value})} style={{ flex: '1 1 100px', padding: '0.75rem', borderRadius: '12px', border: '1px solid #cbd5e1' }} />
          <select value={wishlistForm.category} onChange={e => setWishlistForm({...wishlistForm, category: e.target.value})} style={{ flex: '1 1 130px', padding: '0.75rem', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
            <option value="">カテゴリ選択</option>
            {uniqueCategories.map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={handleAddWishlist} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.75rem', display: 'flex', alignItems: 'center' }} title="追加">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {localWishlist.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>リストは空です</div>
          ) : (
            localWishlist.map(w => (
              <div key={w.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '1rem', borderRadius: '8px', background: w.isApplied ? 'rgba(56, 189, 248, 0.1)' : '#fff', border: '1px solid var(--glass-border)', opacity: w.isApplied ? 1 : 0.6, transition: 'all 0.2s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  {editingWishlistId === w.id ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', width: '100%', gap: '10px', alignItems: 'center' }}>
                      <input type="text" value={editingWishlistForm.name} onChange={e => setEditingWishlistForm({...editingWishlistForm, name: e.target.value})} style={{ flex: '1 1 150px', padding: '0.4rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                      <input type="number" step="0.01" value={editingWishlistForm.amount} onChange={e => setEditingWishlistForm({...editingWishlistForm, amount: e.target.value})} style={{ flex: '1 1 80px', padding: '0.4rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                      <select value={editingWishlistForm.category} onChange={e => setEditingWishlistForm({...editingWishlistForm, category: e.target.value})} style={{ flex: '1 1 100px', padding: '0.4rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        <option value="">カテゴリ選択</option>
                        {uniqueCategories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button onClick={() => handleUpdateWishlist(w.id)} className="action-button primary" style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}>保存</button>
                      <button onClick={() => setEditingWishlistId(null)} className="action-button secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}>取消</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <input type="checkbox" checked={w.isApplied} onChange={(e) => handleToggleWishlist(w.id, e.target.checked)} style={{ width: '20px', height: '20px', cursor: 'pointer' }} />
                        <div>
                          <div style={{ fontWeight: 600, color: w.isApplied ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{w.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{w.category}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <div style={{ fontWeight: 'bold', color: w.isApplied ? 'var(--accent-color)' : 'var(--text-secondary)' }}>{formatCurrency(w.amount)}</div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => handleBuyWishlist(w)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '5px', fontSize: '1.2rem' }} title="買う!">🛒</button>
                          <button onClick={() => { setEditingWishlistId(w.id); setEditingWishlistForm({ name: w.name, amount: String(w.amount), category: w.category }); }} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '5px' }}>✏️</button>
                          <button onClick={() => handleDeleteWishlist(w.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '5px' }}>✕</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {!editingWishlistId && (
                  <div style={{ marginTop: '0.5rem', padding: '0.8rem 1rem', background: w.isApplied ? 'rgba(255, 255, 255, 0.4)' : '#f8fafc', borderRadius: '8px', borderLeft: w.isApplied ? '4px solid #38bdf8' : '4px solid #94a3b8', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {(() => {
                      const wAmount = parseFloat(String(w.amount || 0));
                      const currentSavingsGoal = parseFloat(String(data?.monthlySettings?.[currentRealMonth]?.savingsGoal || 0));
                      let pool = 0;
                      if (w.category === 'イベント準備金') {
                        const eventBonus = categoryBudgets.find((c: CategoryBudget) => c.name === '特別体験・イベント費')?.transferredIn || 0;
                        pool = (savingsAccount?.total || 0) + (mainAccount?.balance || 0) + eventBonus;
                      } else {
                        const categoryBudget = variableCategories.find((c: CategoryBudget) => c.name === w.category);
                        pool = categoryBudget?.remaining || 0;
                      }
                      return <AIAdvice item={w} pool={pool} freeMoney={variableFreeMoney} savingsGoal={currentSavingsGoal} />;
                    })()}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>


      {/* Recent Activity Panel */}
      {data?.records && data.records.length > 0 && (
        <section className="glass-card" style={{ marginTop: '2rem' }}>
          <h2 className="chart-title">🕒 Recent Activity (直近10件)</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="recent-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th className="col-date" style={{ padding: '0.8rem' }}>日付</th>
                  <th className="col-desc" style={{ padding: '0.8rem' }}>メモ・説明</th>
                  <th className="col-category" style={{ padding: '0.8rem' }}>カテゴリ</th>
                  <th className="col-amount" style={{ padding: '0.8rem', textAlign: 'right' }}>金額</th>
                  <th className="col-actions" style={{ padding: '0.8rem', textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {[...(data.records || [])].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10).map((record: any) => {
                  const isIncome = record.recordType === 'income_allowance' || record.recordType === 'income_special' || record.recordType === 'advance_recovery';
                  const amount = isIncome ? record.income : record.expense;
                  return (
                    <tr key={record.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td className="col-date" style={{ padding: '0.8rem' }}>{record.date}</td>
                      <td className="col-desc" style={{ padding: '0.8rem', fontWeight: 500 }}>{record.description}</td>
                      <td className="col-category" style={{ padding: '0.8rem' }}>
                        <span className="category-badge" style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>
                          {record.category}
                        </span>
                      </td>
                      <td className="col-amount" style={{ padding: '0.8rem', textAlign: 'right', fontWeight: 'bold', color: isIncome ? '#059669' : '#e11d48', whiteSpace: 'nowrap' }}>
                        {isIncome ? '+' : '-'}{formatCurrency(amount)}
                      </td>
                      <td className="col-actions" style={{ padding: '0.8rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                          {record.recordType === 'advance_payment' && !record.description?.includes('（回収済）') && (
                            confirmRecoveryId === record.id ? (
                              <button 
                                onClick={async () => {
                                  setConfirmRecoveryId(null);
                                  const payload = {
                                    date: new Date().toISOString().split('T')[0].replace(/-/g, '/'),
                                    category: '入金',
                                    description: `${record.description} (立替回収)`,
                                    amount: amount,
                                    recordType: 'advance_recovery'
                                  };
                                  await fetch('/api/finance', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'add_expense', payload })
                                  });
                                  await fetch('/api/finance', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ action: 'edit_record', payload: { id: record.id, ...record, description: record.description ? `${record.description} （回収済）` : '（回収済）' } })
                                  });
                                  fetchData();
                                }}
                                className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', background: '#16a34a', color: 'white', borderColor: '#16a34a', whiteSpace: 'nowrap' }}
                              >
                                回収する
                              </button>
                            ) : (
                              <button 
                                onClick={() => setConfirmRecoveryId(record.id ?? null)}
                                className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', background: '#dcfce3', color: '#166534', borderColor: '#bbf7d0', whiteSpace: 'nowrap' }}
                              >
                                ✓ 回収
                              </button>
                            )
                          )}
                          <button 
                            onClick={() => handleEditRecord(record)}
                            className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                          >
                            ✏️
                          </button>
                          {confirmDeleteId === record.id ? (
                            <button 
                              onClick={() => handleDeleteRecord(record.id!)}
                              className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', background: '#e11d48', color: 'white', borderColor: '#e11d48' }}
                            >
                              削除する
                            </button>
                          ) : (
                            <button 
                              onClick={() => setConfirmDeleteId(record.id ?? null)}
                              className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', background: '#ffe4e6', color: '#e11d48', borderColor: '#fecdd3' }}
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }).reverse()}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Edit Record Modal */}
      {editingRecordId !== null && (
        <div className="modal-overlay" onClick={() => setEditingRecordId(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="chart-title">✏️ 記録の編集</h2>
            <form onSubmit={handleEditRecordSubmit} className="form-container">
              <label>日付 <input type="text" value={editFormData.date} onChange={e => setEditFormData({...editFormData, date: e.target.value})} required /></label>
              
              <label>
                カテゴリ
                <select value={editFormData.category} onChange={e => setEditFormData({...editFormData, category: e.target.value})} required>
                  {uniqueCategories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>メモ / 品名 <input type="text" value={editFormData.description} onChange={e => setEditFormData({...editFormData, description: e.target.value})} required /></label>
              
              <div style={{ display: 'flex', gap: '10px' }}>
                <label style={{ flex: 1 }}>
                  種類
                  <select value={editFormData.isIncome ? "income" : "expense"} onChange={e => setEditFormData({...editFormData, isIncome: e.target.value === 'income'})}>
                    <option value="expense">支出</option>
                    <option value="income">収入</option>
                  </select>
                </label>
                <label style={{ flex: 1 }}>
                  金額 ($)
                  <input type="number" step="0.01" value={editFormData.amount} onChange={e => setEditFormData({...editFormData, amount: e.target.value})} required />
                </label>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                <button type="submit" className="action-button primary">保存する</button>
                <button type="button" onClick={() => setEditingRecordId(null)} className="action-button">キャンセル</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="charts-grid" style={{ marginTop: '2rem' }}>
        <div style={{ perspective: '1000px' }}>
          <div style={{
            position: 'relative',
            width: '100%',
            transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            transformStyle: 'preserve-3d',
            transform: (deepAnalysis || isDeepAnalyzing) ? 'rotateY(180deg)' : 'rotateY(0deg)'
          }}>
            {/* FRONT FACE: Expense Pie Chart */}
            <div style={{
              width: '100%',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              pointerEvents: (deepAnalysis || isDeepAnalyzing) ? 'none' : 'auto',
              opacity: (deepAnalysis || isDeepAnalyzing) ? 0 : 1,
              transition: 'opacity 0.6s',
            }}>
              <ExpensePieChart
                selectedMonth={selectedMonth}
                currentRealMonth={currentRealMonth}
                generatedPieData={generatedPieData}
                visibleExpenseData={visibleExpenseData}
                uniqueCategories={uniqueCategories}
                hiddenCategories={hiddenCategories}
                setHiddenCategories={setHiddenCategories}
                onDeepAnalyzeClick={handleDeepAnalysis}
                isDeepAnalyzing={isDeepAnalyzing}
              />
            </div>

            {/* BACK FACE: AI Deep Analysis */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              pointerEvents: (deepAnalysis || isDeepAnalyzing) ? 'auto' : 'none',
              opacity: (deepAnalysis || isDeepAnalyzing) ? 1 : 0,
              transition: 'opacity 0.6s',
            }}>
              <div className="glass-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'rgba(255, 255, 255, 0.95)', borderRadius: '12px', border: '1px solid #e9d5ff', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
                  <h3 style={{ color: '#9333ea', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem' }}>
                    <span>✨</span> AIディープインサイト ({selectedMonth})
                  </h3>
                  <button 
                    onClick={() => setDeepAnalysis('')}
                    style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
                  >×</button>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', lineHeight: '1.6', fontSize: '0.95rem', overflowY: 'auto', flex: 1, paddingRight: '10px' }}>
                  {isDeepAnalyzing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                      <div className="spinner" style={{ marginBottom: '1rem', width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid #9333ea', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                      <div>AIが家計データを分析し、インサイトを生成しています...</div>
                    </div>
                  ) : (
                    (deepAnalysis || '').split('\n').map((line, i) => {
                      const parts = line.split(/(\*\*.*?\*\*)/g);
                      return (
                        <div key={i} style={{ marginBottom: line.trim() === '' ? '0.5rem' : '0' }}>
                          {parts.map((part, j) => {
                            if (part.startsWith('**') && part.endsWith('**')) {
                              return <strong key={j} style={{ color: 'var(--accent-color)' }}>{part.slice(2, -2)}</strong>;
                            }
                            return part;
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
                <div style={{ textAlign: 'center', marginTop: '1rem', flexShrink: 0 }}>
                  <button 
                    className="action-button secondary"
                    onClick={() => setDeepAnalysis('')}
                    style={{ fontSize: '0.9rem', padding: '0.5rem 1.5rem' }}
                  >
                    🔙 グラフに戻る
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>


        <MonthlyBarChart  
          monthlyData={data?.monthlyData || []} 
          expenseData={data?.expenseData || []} 
          monthlySettings={data?.monthlySettings || {}}
          onMonthClick={(month) => setSelectedMonth(month)}
        />
      <div className="glass-card">
        <h2 className="chart-title">{targetReviewMonth === lastMonthStr ? '先月の振り返り' : `${targetReviewMonth} の振り返り`} ({targetReviewMonth})</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)' }}>設定した全体予算</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>{formatCurrency(targetReviewBudget)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)' }}>実際の支出</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: targetReviewSpent > targetReviewBudget ? 'var(--warning-color)' : 'var(--success-color)' }}>
              {formatCurrency(targetReviewSpent)}
            </span>
          </div>
          
          <hr style={{ border: 'none', borderTop: '1px dashed var(--glass-border)', margin: '5px 0' }} />
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold' }}>予算達成状況</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: targetReviewSpent > targetReviewBudget ? 'var(--warning-color)' : 'var(--success-color)' }}>
                {targetReviewSpent > targetReviewBudget 
                  ? `-$${(targetReviewSpent - targetReviewBudget).toFixed(2)} (オーバー)` 
                  : `+$${(targetReviewBudget - targetReviewSpent).toFixed(2)} (黒字)`}
              </span>
            </div>
            
            <div style={{ marginTop: '10px', fontSize: '0.95rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.4)', padding: '15px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
              {targetReviewSpent === 0 
                ? `${targetReviewMonth}のデータがまだありません。支出を記録しましょう！`
                : targetReviewSpent > targetReviewBudget 
                  ? "予算をオーバーしてしまいました。今月は少し節約を意識して、予算内に収まるよう頑張りましょう！" 
                  : "素晴らしい！予算内にしっかり収まりました。この調子で計画的に管理していきましょう！✨"}
            </div>
          </div>
        </div>
      </section>



      <section style={{ textAlign: 'center', padding: '2rem 1rem', marginTop: '2rem', display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
        <button type="button" className="action-button primary" onClick={() => setShowOffsetModal(true)} style={{ fontSize: '0.9rem', padding: '0.5rem 1rem', background: '#ecfdf5', color: '#059669', border: '1px solid #34d399', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.1)', fontWeight: 'bold' }}>
          🤝 割り勘カンタン一括回収
        </button>
        <input type="file" accept=".csv" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
        <button type="button" className="action-button secondary" onClick={handleExportData} style={{ fontSize: '0.9rem', padding: '0.5rem 1rem' }}>
          バックアップを保存 (JSON)
        </button>
        <label className="action-button secondary" style={{ fontSize: '0.9rem', padding: '0.5rem 1rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
          データを復元
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportData} />
        </label>
        <button type="button" className="action-button secondary" onClick={() => setShowRawEditor(true)} style={{ fontSize: '0.9rem', padding: '0.5rem 1rem' }}>
          直接データを編集 (JSON)
        </button>
      </section>

      {/* Expense Modal */}
      {showExpenseModal && (
        <ExpenseModal
          onClose={() => setShowExpenseModal(false)}
          expenseForm={expenseForm}
          setExpenseForm={setExpenseForm}
          isNewCategory={isNewCategory}
          setIsNewCategory={setIsNewCategory}
          newCategoryName={newCategoryName}
          setNewCategoryName={setNewCategoryName}
          wishlistIdToDeleteOnAdd={wishlistIdToDeleteOnAdd}
          setWishlistIdToDeleteOnAdd={setWishlistIdToDeleteOnAdd}
          uniqueCategories={uniqueCategories}
        />
      )}

      {/* Transfer Budget Modal */}
      {showTransferModal && (
        <TransferModal
          onClose={() => setShowTransferModal(false)}
          currentRealMonth={currentRealMonth}
          variableCategories={variableCategories}
          uniqueCategories={uniqueCategories}
        />
      )}

      {/* Fixed Expenses / Budget Modal (Table Format) */}
      {showFixedModal && (
        <FixedExpensesModal
          onClose={() => setShowFixedModal(false)}
          currentRealMonth={currentRealMonth}
        />
      )}

      {showRawEditor && (
        <RawJsonEditorModal
          onClose={() => setShowRawEditor(false)}
        />
      )}

      {/* Offset Modal */}
      {showOffsetModal && (
        <OffsetModal
          onClose={() => setShowOffsetModal(false)}
          uniqueCategories={uniqueCategories}
        />
      )}

      {/* Reconcile Modal */}
      {showReconcileModal && (
        <TripReconcileModal onClose={() => setShowReconcileModal(false)} />
      )}


      {/* CSV Reconcile Modal */}
      {showCsvModal && (
        <CsvReconcileModal onClose={() => setShowCsvModal(false)} csvRecords={csvRecords} setCsvRecords={setCsvRecords} />
      )}

      {/* Custom Alert Modal */}
      {alertModal.isOpen && (
        <div className="modal-overlay" onClick={() => setAlertModal({ ...alertModal, isOpen: false })}>
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', textAlign: 'center', zIndex: 10000 }}>
            <h2 style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '1.2rem' }}>{alertModal.title}</h2>
            <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{alertModal.message}</p>
            <button className="action-button primary" onClick={() => setAlertModal({ ...alertModal, isOpen: false })} style={{ width: '100%', padding: '0.8rem', fontSize: '1rem' }}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* Custom Confirm Modal */}
      {confirmModal.isOpen && (
        <div className="modal-overlay" onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}>
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', textAlign: 'center', zIndex: 10000 }}>
            <h2 style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '1.2rem' }}>{confirmModal.title}</h2>
            <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{confirmModal.message}</p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button className="action-button secondary" onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })} style={{ flex: 1, padding: '0.8rem', fontSize: '1rem' }}>
                キャンセル
              </button>
              <button className="action-button primary" onClick={() => { confirmModal.onConfirm(); setConfirmModal({ ...confirmModal, isOpen: false }); }} style={{ flex: 1, padding: '0.8rem', fontSize: '1rem', background: confirmModal.confirmColor || '#ef4444', borderColor: confirmModal.confirmColor || '#ef4444' }}>
                {confirmModal.confirmText || '実行'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}