import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppData, MonthlySettings, WishlistItem } from '../types';

export const useFinanceData = () => {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [monthlySettings, setMonthlySettings] = useState<Record<string, MonthlySettings>>({});
  const [localWishlist, setLocalWishlist] = useState<WishlistItem[]>([]);
  const [ignoredBudgetCategories, setIgnoredBudgetCategories] = useState<string[]>([]);

  const fetchData = useCallback(async (targetMonth?: string) => {
    setLoading(true);
    try {
      const timestamp = new Date().getTime();
      const clientDate = new Date();
      const clientMonth = targetMonth || `${clientDate.getFullYear()}-${String(clientDate.getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/finance?t=${timestamp}&clientMonth=${clientMonth}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('API Request Failed');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const resData = json.data || json;
      setData(resData);
      setMonthlySettings(resData.monthlySettings || {});
      setLocalWishlist(resData.wishlist || []);
      setIgnoredBudgetCategories(resData.ignoredBudgetCategories || []);
      return resData;
    } catch (err) {
      console.error(err);
      setError('データの読み込みに失敗しました。');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Mutations
  const addWishlist = async (payload: { id: string, name: string, amount: string | number, category: string }) => {
    await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_wishlist', payload })
    });
    await fetchData();
  };

  const toggleWishlist = async (id: string, isApplied: boolean) => {
    await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_wishlist', payload: { id, isApplied } })
    });
    await fetchData();
  };

  const deleteWishlist = async (id: string) => {
    await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_wishlist', payload: { id } })
    });
    await fetchData();
  };

  const updateWishlist = async (id: string, payload: { name: string, amount: string | number, category: string }) => {
    await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_wishlist', payload: { id, ...payload } })
    });
    await fetchData();
  };

  const toggleIgnoredBudgetCategory = async (category: string, isIgnored: boolean) => {
    const current = [...ignoredBudgetCategories];
    let newCategories;
    if (isIgnored && !current.includes(category)) {
      newCategories = [...current, category];
    } else if (!isIgnored) {
      newCategories = current.filter(c => c !== category);
    } else {
      newCategories = current;
    }
    setIgnoredBudgetCategories(newCategories);
    
    await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_ignored_budget_category', payload: { category, isIgnored } })
    });
    await fetchData();
  };

  const editRecord = async (id: string, payload: any) => {
    await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit_record', payload: { id, ...payload } })
    });
    await fetchData();
  };

  const deleteRecord = async (id: string) => {
    await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_record', payload: { id } })
    });
    await fetchData();
  };

  const calculateAutoCover = (neededAmount: number, toCategoryName: string = 'ガソリン交通費') => {
    const entertainmentCat = data?.categoryBudgets?.find(c => c.category === '娯楽費' || c.name === '娯楽費');
    const eventCat = data?.categoryBudgets?.find(c => c.category === '特別体験・イベント費' || c.name === '特別体験・イベント費');
    
    let remainingNeeded = neededAmount;
    const transfersToMake = [];
    
    if (entertainmentCat && (entertainmentCat.remaining || 0) > 0) {
      const amount = Math.min(remainingNeeded, (entertainmentCat.remaining || 0));
      transfersToMake.push({ from: '娯楽費', to: toCategoryName, amount });
      remainingNeeded -= amount;
    }
    
    if (remainingNeeded > 0 && eventCat && (eventCat.remaining || 0) > 0) {
      const amount = Math.min(remainingNeeded, (eventCat.remaining || 0));
      transfersToMake.push({ from: '特別体験・イベント費', to: toCategoryName, amount });
      remainingNeeded -= amount;
    }
    
    if (transfersToMake.length === 0) {
      throw new Error('補填できる「娯楽費」または「特別体験・イベント費」の予算がありません。');
    }

    return transfersToMake;
  };

  const executeAutoCover = async (transfersToMake: any[], currentRealMonth: string) => {
    for (const t of transfersToMake) {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'transfer_budget', 
          payload: { month: currentRealMonth, fromCategory: t.from, toCategory: t.to, amount: t.amount.toString() }
        })
      });
    }
    await fetchData();
    return transfersToMake;
  };

  const exportData = async () => {
    const res = await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'export_db' })
    });
    const result = await res.json();
    if (result.success && result.db) {
      const jsonStr = JSON.stringify(result.db, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      a.download = `smart-money-backup-${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      throw new Error('バックアップの作成に失敗しました。');
    }
  };

  const importData = async (file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string;
          const dbData = JSON.parse(content);
          const res = await fetch('/api/finance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'import_db', payload: dbData })
          });
          const result = await res.json();
          if (result.success) {
            await fetchData();
            resolve();
          } else {
            reject(new Error(result.error || 'リストアに失敗しました。'));
          }
        } catch (err) {
          reject(new Error('JSONの形式が正しくありません。'));
        }
      };
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
      reader.readAsText(file);
    });
  };

  return useMemo(() => ({
    data,
    loading,
    error,
    monthlySettings,
    localWishlist,
    setLocalWishlist,
    ignoredBudgetCategories,
    fetchData,
    addWishlist,
    toggleWishlist,
    deleteWishlist,
    updateWishlist,
    toggleIgnoredBudgetCategory,
    editRecord,
    deleteRecord,
    calculateAutoCover,
    executeAutoCover,
    exportData,
    importData
  }), [
    data, loading, error, monthlySettings, localWishlist, ignoredBudgetCategories, fetchData
  ]);
};
