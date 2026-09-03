import React, { useState, useEffect } from 'react';
import { AppData, ExpenseData, FixedExpense, MonthlySettings } from '../../types';
import { useFinanceContext } from '../../context/FinanceContext';

interface FixedExpensesModalProps {
  onClose: () => void;  currentRealMonth: string;}

export const FixedExpensesModal: React.FC<FixedExpensesModalProps> = ({
  onClose,
  currentRealMonth}) => {
    const { data, ignoredBudgetCategories, toggleIgnoredBudgetCategory: handleToggleIgnoredBudgetCategory, monthlySettings, fetchData } = useFinanceContext();
  const [tempSettings, setTempSettings] = useState<Record<string, MonthlySettings>>({});
  const [showCategorySettings, setShowCategorySettings] = useState(false);
  const [showPastMonths, setShowPastMonths] = useState(false);

  useEffect(() => {
    if (!data?.monthlySettings) return;
    const monthlySettings = data.monthlySettings;
    const allCategories = data.expenseData ? data.expenseData.map((d: ExpenseData) => d.name).filter((n: string) => n !== '入金') : [];
    
    const clone: Record<string, MonthlySettings> = {};
    Object.keys(monthlySettings).forEach(month => {
      clone[month] = JSON.parse(JSON.stringify(monthlySettings[month]));
      allCategories.forEach((catName: string, idx: number) => {
         const existing = clone[month].fixedExpenses.find((f: FixedExpense) => f.name === catName);
         if (!existing) {
           clone[month].fixedExpenses.push({ id: `cat_${idx}_${Date.now()}`, name: catName, amount: 0 });
         }
      });
    });
    
    if (!clone[currentRealMonth]) {
      const pastMonths = Object.keys(monthlySettings)
        .filter(m => m < currentRealMonth)
        .sort((a, b) => b.localeCompare(a));
        
      if (pastMonths.length > 0) {
        const lastMonth = pastMonths[0];
        clone[currentRealMonth] = JSON.parse(JSON.stringify(monthlySettings[lastMonth]));
      } else {
        const defaultFixed = allCategories.map((name: string, i: number) => ({ id: `cat_${i}`, name, amount: 0 }));
        clone[currentRealMonth] = { fixedExpenses: defaultFixed, savingsGoal: 0 };
      }
      
      allCategories.forEach((catName: string, idx: number) => {
         const existing = clone[currentRealMonth].fixedExpenses.find((f: FixedExpense) => f.name === catName);
         if (!existing) {
           clone[currentRealMonth].fixedExpenses.push({ id: `cat_${idx}_${Date.now()}`, name: catName, amount: 0 });
         }
      });
    }

    // Fill any gaps between earliest and latest months
    const existingMonths = Object.keys(clone).sort();
    if (existingMonths.length >= 2) {
      const earliest = existingMonths[0];
      const latest = existingMonths[existingMonths.length - 1];
      let curr = earliest;
      while (curr < latest) {
        const parts = curr.split('-');
        let year = parseInt(parts[0]);
        let month = parseInt(parts[1]);
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
        const nextMonthStr = `${year}-${String(month).padStart(2, '0')}`;
        if (!clone[nextMonthStr]) {
          clone[nextMonthStr] = JSON.parse(JSON.stringify(clone[curr]));
        }
        curr = nextMonthStr;
      }
    }

    setTempSettings(clone);
  }, [data, currentRealMonth]);

  const handleDeleteMonth = async (monthToDelete: string) => {
    const newTemp = { ...tempSettings };
    delete newTemp[monthToDelete];
    setTempSettings(newTemp);
    
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_monthly_settings', payload: { month: monthToDelete } })
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };
  
  const addNextMonthToTemp = () => {
    const months = Object.keys(tempSettings).sort();
    const latestMonth = months[months.length - 1] || currentRealMonth;
    const parts = latestMonth.split('-');
    let year = parseInt(parts[0]);
    let month = parseInt(parts[1]);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const nextMonthStr = `${year}-${String(month).padStart(2, '0')}`;
    
    const clone = { ...tempSettings };
    clone[nextMonthStr] = JSON.parse(JSON.stringify(tempSettings[latestMonth]));
    setTempSettings(clone);
  };

  const addPrevMonthToTemp = () => {
    const months = Object.keys(tempSettings).sort();
    const earliestMonth = months[0] || currentRealMonth;
    const parts = earliestMonth.split('-');
    let year = parseInt(parts[0]);
    let month = parseInt(parts[1]);
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    const prevMonthStr = `${year}-${String(month).padStart(2, '0')}`;
    
    const clone = { ...tempSettings };
    // Use current month's settings as default for past months, as requested
    const referenceSettings = clone[currentRealMonth] || clone[earliestMonth];
    clone[prevMonthStr] = JSON.parse(JSON.stringify(referenceSettings));
    setTempSettings(clone);
  };

  const handleSaveAllMonthlySettings = async () => {
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'batch_update_monthly_settings', 
          payload: { 
            settings: tempSettings
          } 
        })
      });
      onClose();
      fetchData();
    } catch (err) {
      (typeof window !== "undefined" && (window as any).showAlert || window.alert)('保存に失敗しました');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content large" onClick={e => e.stopPropagation()}>
        <h2 className="chart-title">今後の予算・固定費設定/予定</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>月ごとの予算（固定費・変動費とイベント準備金の目標積立）を表形式で一括設定できます。</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginBottom: '1rem' }}>
          <button 
            type="button" 
            className="action-button secondary" 
            onClick={() => setShowPastMonths(!showPastMonths)}
            style={{ fontSize: '0.9rem', padding: '0.5rem 1rem' }}
          >
            {showPastMonths ? '🔼 過去の月を隠す' : '🔽 過去の月を表示'}
          </button>
          <button 
            type="button" 
            className="action-button secondary" 
            onClick={() => setShowCategorySettings(!showCategorySettings)}
            style={{ fontSize: '0.9rem', padding: '0.5rem 1rem' }}
          >
            ⚙️ 表示カテゴリ設定
          </button>
        </div>
        
        {showCategorySettings && (
          <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--glass-border)' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>グラフ・予算から除外するカテゴリ（一時的な大型出費）</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'white', padding: '0.3rem 0.6rem', borderRadius: '20px', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={ignoredBudgetCategories.includes('特別体験・イベント費')} 
                  onChange={(e) => handleToggleIgnoredBudgetCategory('特別体験・イベント費', e.target.checked)} 
                />
                <span style={{ fontSize: '0.9rem' }}>特別体験・イベント費を予算およびグラフ計算から除外する</span>
              </label>
            </div>
          </div>
        )}
        
        <div className="fixed-table-container">
          <table className="fixed-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ minWidth: '100px' }}>対象月</th>
                {data?.expenseData && data.expenseData.map((d: ExpenseData) => d.name).filter((n: string) => n !== '入金' && !ignoredBudgetCategories.includes(n)).map((catName: string) => (
                  <th key={catName} style={{ minWidth: '100px' }}>{catName} ($)</th>
                ))}
                <th style={{ color: 'var(--success-color)', minWidth: '100px' }}>特別体験・イベント準備金（目標積立） ($)</th>
                <th style={{ color: '#f97316', minWidth: '100px' }}>合計予算 ($)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(tempSettings).sort().map((monthStr, rowIndex) => {
                const s = tempSettings[monthStr];
                const isPast = monthStr < currentRealMonth;
                const allCategories = data?.expenseData ? data.expenseData.map((d: ExpenseData) => d.name).filter((n: string) => n !== '入金' && !ignoredBudgetCategories.includes(n)) : [];
                
                if (isPast && !showPastMonths) return null;

                return (
                  <tr key={monthStr} style={{ opacity: isPast ? 0.6 : 1, background: monthStr === currentRealMonth ? '#f0f9ff' : 'transparent' }}>
                    <td style={{ fontWeight: monthStr === currentRealMonth ? 'bold' : 'normal' }}>
                      {monthStr} {monthStr === currentRealMonth ? '(今月)' : ''}
                    </td>
                    
                    {allCategories.map(catName => {
                      const fixed = s.fixedExpenses.find(f => f.name === catName);
                      return (
                        <td key={catName}>
                          <input 
                            type="number"
                            min="0"
                            step="10"
                            value={fixed ? fixed.amount : 0}
                            style={{ width: '100%', padding: '0.3rem', border: '1px solid #e2e8f0', borderRadius: '4px' }}
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              const clone = { ...tempSettings };
                              const existingIdx = clone[monthStr].fixedExpenses.findIndex(f => f.name === catName);
                              if (existingIdx !== -1) {
                                clone[monthStr].fixedExpenses[existingIdx].amount = val;
                              }
                              setTempSettings(clone);
                            }}
                          />
                        </td>
                      );
                    })}
                    
                    <td>
                      <input 
                        type="number"
                        min="0"
                        step="10"
                        value={s.savingsGoal || 0}
                        style={{ width: '100%', padding: '0.3rem', border: '1px solid var(--success-color)', borderRadius: '4px', background: '#f0fdf4' }}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 0;
                          const clone = { ...tempSettings };
                          clone[monthStr].savingsGoal = val;
                          setTempSettings(clone);
                        }}
                      />
                    </td>
                    
                    <td style={{ fontWeight: 'bold', color: '#f97316' }}>
                      {s.fixedExpenses.reduce((sum, f) => sum + (Number(f.amount) || 0), 0) + (Number(s.savingsGoal) || 0)}
                    </td>
                    
                    <td>
                      <button onClick={() => handleDeleteMonth(monthStr)} className="action-button danger" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }} title="削除">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        <div style={{ marginTop: '1rem', display: 'flex', gap: '10px' }}>
          <button type="button" className="action-button secondary" onClick={addPrevMonthToTemp} style={{ flex: 1 }}>- 過去の月を追加する</button>
          <button type="button" className="action-button secondary" onClick={addNextMonthToTemp} style={{ flex: 1 }}>+ 次の月を追加する</button>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '2rem' }}>
          <button type="button" className="action-button primary" onClick={handleSaveAllMonthlySettings} style={{ flex: 1 }}>すべて保存</button>
          <button type="button" className="action-button secondary" onClick={onClose} style={{ flex: 1 }}>キャンセル</button>
        </div>
      </div>
    </div>
  );
};
