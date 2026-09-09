import React from 'react';
import { formatCurrency } from '../lib/format';
import { CategoryBudget, AccountBalance, FixedExpense } from '../types';

interface DashboardStatsProps {
  summary: any;
  variableFreeMoney: number;
  earmarkedMoney: number;
  variableWishlistDeductions: number;
  setShowTransferModal: (v: boolean) => void;
  categoryBudgets: any[];
  savingsAccount: any;
  mainAccount: any;
  data: any;
  currentRealMonth: string;
  eventWishlistDeductions: number;
  eventFundCovered: number;
  unrecoveredAdvances: any[];
  confirmRecoveryId: string | null;
  setConfirmRecoveryId: (id: string | null) => void;
  fetchData: () => void;
  setShowReconcileModal: (v: boolean) => void;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  summary,
  variableFreeMoney,
  earmarkedMoney,
  variableWishlistDeductions,
  setShowTransferModal,
  categoryBudgets,
  savingsAccount,
  mainAccount,
  data,
  currentRealMonth,
  eventWishlistDeductions,
  eventFundCovered,
  unrecoveredAdvances,
  confirmRecoveryId,
  setConfirmRecoveryId,
  fetchData,
  setShowReconcileModal
}) => {
  return (
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
              {unrecoveredAdvances.map((adv: any) => {
                const desc = adv.description || '';
                let alreadyRecovered = 0;
                const match = desc.match(/（一部回収:?\s*([0-9.]+)）/);
                if (match) {
                  alreadyRecovered = parseFloat(match[1]) || 0;
                }
                const remaining = Math.max(0, (parseFloat(adv.expense) || 0) - alreadyRecovered);

                return (
                  <div key={adv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.8)', padding: '8px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                    <div style={{ fontSize: '0.85rem', color: '#7f1d1d' }}>
                      <span style={{ fontWeight: 'bold' }}>{adv.date}</span> - {desc} <br/>
                      <span style={{ fontWeight: 'bold' }}>{formatCurrency(remaining)}</span>
                      {alreadyRecovered > 0 && <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '6px' }}>(元本: {formatCurrency(adv.expense)})</span>}
                    </div>
                    <div>
                      {confirmRecoveryId === adv.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-end' }}>
                          <button 
                            onClick={async () => {
                              const amountStr = window.prompt(`いくら回収しましたか？\n(未回収分: ${remaining})`, String(remaining));
                              if (!amountStr) {
                                setConfirmRecoveryId(null);
                                return;
                              }
                              const amount = parseFloat(amountStr);
                              if (isNaN(amount) || amount <= 0) return;

                              setConfirmRecoveryId(null);
                              const newRecovered = alreadyRecovered + amount;
                              const isFull = newRecovered >= (parseFloat(adv.expense) || 0);
                              const cleanDesc = desc.replace(/（一部回収:?\s*[0-9.]+）/g, '').trim();
                              const newDesc = isFull ? `${cleanDesc} （回収済）` : `${cleanDesc} （一部回収: ${newRecovered}）`;

                              const payload = {
                                date: new Date().toISOString().split('T')[0].replace(/-/g, '/'),
                                category: '入金',
                                description: `${cleanDesc} (立替回収: ${amount})`,
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
                                body: JSON.stringify({ action: 'edit_record', payload: { id: adv.id, ...adv, description: newDesc } })
                              });
                              fetchData();
                            }}
                            className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', background: '#16a34a', color: 'white', borderColor: '#16a34a', whiteSpace: 'nowrap' }}
                          >
                            ＋ 新規入金して回収
                          </button>
                          <button 
                            onClick={async () => {
                              const amountStr = window.prompt(`いくら回収済みとしてマークしますか？\n(未回収分: ${remaining})`, String(remaining));
                              if (!amountStr) {
                                setConfirmRecoveryId(null);
                                return;
                              }
                              const amount = parseFloat(amountStr);
                              if (isNaN(amount) || amount <= 0) return;

                              setConfirmRecoveryId(null);
                              const newRecovered = alreadyRecovered + amount;
                              const isFull = newRecovered >= (parseFloat(adv.expense) || 0);
                              const cleanDesc = desc.replace(/（一部回収:?\s*[0-9.]+）/g, '').trim();
                              const newDesc = isFull ? `${cleanDesc} （回収済）` : `${cleanDesc} （一部回収: ${newRecovered}）`;

                              await fetch('/api/finance', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'edit_record', payload: { id: adv.id, ...adv, description: newDesc } })
                              });
                              fetchData();
                            }}
                            className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', background: '#e2e8f0', color: '#334155', borderColor: '#cbd5e1', whiteSpace: 'nowrap' }}
                          >
                            ✓ 記録済み（マークのみ）
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmRecoveryId(adv.id)} className="action-button secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}>✓ 回収</button>
                      )}
                    </div>
                  </div>
                );
              })}
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
  );
};
