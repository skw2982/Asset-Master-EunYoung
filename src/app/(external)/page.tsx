"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis
} from "recharts";

// ═══════════════════════════════════════════
// ☁️ Config
// ═══════════════════════════════════════════
const BASE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSL3Ps1zpYTsWkrh8Wv6s9RQfRM1Fg-XVEbJGJGeaIG2Xmoz7yzFoBGie0fzU4aeX8eTswp5z4_3je5/pub?";

const GIDS = { STOCKS: "0", REALIZED: "817751922", ASSETS: "1398634207", DEBTS: "359303564", SAVINGS: "380349145" };

const cleanNum = (val: unknown): number => {
  if (val == null || val === "") return 0;
  const n = parseFloat(String(val).replace(/[^0-9.\-]+/g, ""));
  return isNaN(n) ? 0 : n;
};

const fmt = (num: number): string => Math.round(num).toLocaleString("ko-KR");
const fmtShort = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(1) + "억";
  if (abs >= 1e4) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
  return fmt(n);
};

const safeParseRow = (row: string) => {
  const result = [];
  let insideQuotes = false;
  let currentVal = "";
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') insideQuotes = !insideQuotes;
    else if (char === ',' && !insideQuotes) { result.push(currentVal.replace(/"/g, "").trim()); currentVal = ""; }
    else currentVal += char;
  }
  result.push(currentVal.replace(/"/g, "").trim());
  return result;
};

const fetchWithTimeout = async (url: string, timeoutMs = 8000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
};

interface Stock { market: string; account: string; name: string; qty: number; avg: number; current: number; dailyChange: number; }
interface Asset { id: number; name: string; value: number; }
interface Debt { id: number; name: string; value: number; }
interface Saving { id: number; name: string; monthly: number; current: number; maturityDate: string; transferDay: number; interestRate: number; }
interface Realized { date: string; name: string; qty: number; profit: number; yieldRate: number; note: string; }

type TabKey = "overview" | "stocks" | "realestate" | "savings" | "realized" | "goal";
const TABS: { key: TabKey; label: string; num: string; icon: string }[] = [
  { key: "overview", label: "자산 요약", num: "1", icon: "📊" },
  { key: "stocks", label: "보유 주식/현금", num: "2", icon: "💳" },
  { key: "realestate", label: "실물/부채", num: "3", icon: "🏠" },
  { key: "savings", label: "예적금", num: "4", icon: "🏦" },
  { key: "realized", label: "실현 손익", num: "5", icon: "💰" },
  { key: "goal", label: "내 집 마련", num: "6", icon: "🎯" },
];

const pctColor = (v: number) => (v > 0 ? "text-rose-400" : v < 0 ? "text-blue-400" : "text-slate-400");
const pctSign = (v: number) => (v > 0 ? "+" : "");

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-slate-900/80 backdrop-blur rounded-[28px] border border-slate-800/80 shadow-xl ${className}`}>{children}</div>;
}

function StatCard({ label, value, sub, variant = "default", icon }: { label: string; value: string; sub?: string; variant?: "default" | "danger" | "success" | "warning"; icon?: string; }) {
  const styles = {
    default: "bg-slate-900/80 border-slate-800 text-white",
    danger: "bg-gradient-to-br from-rose-950/40 to-slate-900 border-rose-900/50 text-rose-300",
    success: "bg-gradient-to-br from-emerald-950/40 to-slate-900 border-emerald-900/50 text-emerald-300",
    warning: "bg-gradient-to-br from-amber-950/40 to-slate-900 border-amber-900/50 text-amber-300",
  };
  return (
    <div className={`p-5 rounded-3xl border ${styles[variant]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="text-xs opacity-70">{icon}</span>}
        <p className="text-[10px] font-black uppercase tracking-widest opacity-60">{label}</p>
      </div>
      <p className="text-2xl font-black tracking-tight">{value}</p>
      {sub && <p className="text-xs mt-1 opacity-60 font-medium">{sub}</p>}
    </div>
  );
}

export default function MomAssetMaster() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [isClient, setIsClient] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState("SYNC DATA");
  
  const [lastUpdated, setLastUpdated] = useState("");
  const [exchangeRate, setExchangeRate] = useState(1350);

  const [stocks, setStocks] = useState<Stock[]>([]);
  const [realized, setRealized] = useState<Realized[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [savings, setSavings] = useState<Saving[]>([]);
  
  // 🎯 목표 하드코딩 (웹 저장 방식 완전 제거)
  const propertyGoal = { name: "여의도 미성 47평", price: 3100000000 };

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      setSyncStatusMsg("환율 서버 통신 중...");
      let currentRate = 1350;
      try {
        const rateRes = await fetchWithTimeout("https://open.er-api.com/v6/latest/USD", 5000);
        if (rateRes.ok) {
          const rData = await rateRes.json();
          if (rData?.rates?.KRW) currentRate = rData.rates.KRW;
        }
      } catch (e) { console.warn("환율 서버 무응답"); }
      setExchangeRate(currentRate);

      setSyncStatusMsg("구글 시트 연동 중...");
      const fetchCSV = async (gid: string) => {
        try {
          const res = await fetchWithTimeout(`${BASE_CSV_URL}gid=${gid}&single=true&output=csv&t=${Date.now()}`, 8000);
          if (!res.ok) return [];
          const text = await res.text();
          if (text.trim().startsWith("<")) return [];
          return text.split("\n").map(r => r.trim()).filter(Boolean).slice(1);
        } catch { return []; }
      };

      const [sRows, rRows, aRows, dRows, svRows] = await Promise.all([
        fetchCSV(GIDS.STOCKS), fetchCSV(GIDS.REALIZED), fetchCSV(GIDS.ASSETS), fetchCSV(GIDS.DEBTS), fetchCSV(GIDS.SAVINGS)
      ]);

      setStocks(sRows.map(row => { 
        const c = safeParseRow(row); 
        return { market: c[0]||"", account: c[1]||"", name: c[2]||"", avg: cleanNum(c[5]), current: cleanNum(c[6]), qty: cleanNum(c[7]), dailyChange: cleanNum(c[8]) }; 
      }).filter(s => s.qty > 0)); 
      
      setRealized(rRows.map(row => { const c = safeParseRow(row); return { date: c[0]||"", name: c[1]||"", qty: cleanNum(c[2]), profit: cleanNum(c[3]), yieldRate: cleanNum(c[4]), note: c[5]||"" }; }));
      setAssets(aRows.map((row, i) => { const c = safeParseRow(row); return { id: i, name: c[0]||"", value: cleanNum(c[1]) }; }));
      setDebts(dRows.map((row, i) => { const c = safeParseRow(row); return { id: i, name: c[0]||"", value: cleanNum(c[1]) }; }));
      setSavings(svRows.map((row, i) => { const c = safeParseRow(row); return { id: i, name: c[0]||"", monthly: cleanNum(c[1]), current: cleanNum(c[2]), maturityDate: c[3]||"", transferDay: cleanNum(c[4]), interestRate: cleanNum(c[5]) }; }));
      
      setLastUpdated(new Date().toLocaleTimeString("ko-KR"));
      setSyncStatusMsg("REFRESH"); 
    } catch (e) {
      setSyncStatusMsg("통신 실패! 다시 클릭");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsClient(true);
    fetchAllData();
  }, [fetchAllData]);

  const grouped = useMemo(() => {
    const acc: Record<string, { items: Stock[]; total: number; stockTotal: number; profit: number; dailyProfit: number }> = {};
    if (!stocks.length) return acc;
    stocks.forEach((s) => {
      if (!s.market) return;
      const isCash = s.name.includes("예수금") || s.name.includes("현금");
      const isOS = s.market.includes("해외") && !isCash; 
      const rate = isOS ? exchangeRate : 1;
      
      if (!acc[s.account]) acc[s.account] = { items: [], total: 0, stockTotal: 0, profit: 0, dailyProfit: 0 };
      
      acc[s.account].items.push(s);
      acc[s.account].total += s.current * rate * s.qty; 
      
      if (!isCash) {
          acc[s.account].stockTotal += s.current * rate * s.qty; 
          acc[s.account].profit += (s.current - s.avg) * rate * s.qty;
          acc[s.account].dailyProfit += s.dailyChange * rate * s.qty;
      }
    });
    return acc;
  }, [stocks, exchangeRate]);

  const totalStockVal = useMemo(() => stocks.reduce((a, b) => {
      const isCash = b.name.includes("예수금") || b.name.includes("현금");
      const rate = (b.market?.includes("해외") && !isCash) ? exchangeRate : 1;
      return a + b.current * rate * b.qty;
  }, 0), [stocks, exchangeRate]);
  
  const totalAssetsVal = useMemo(() => assets.reduce((a, b) => a + b.value, 0), [assets]);
  const totalSavingsVal = useMemo(() => savings.reduce((a, b) => a + b.current, 0), [savings]);
  const totalDebtsVal = useMemo(() => debts.reduce((a, b) => a + b.value, 0), [debts]);
  const netWorth = totalStockVal + totalAssetsVal + totalSavingsVal - totalDebtsVal;

  const goalGap = propertyGoal.price - netWorth;
  const goalProgress = Math.min(100, Math.max(0, (netWorth / propertyGoal.price) * 100)) || 0;

  const yearlyRealized = useMemo(() => {
    const acc: Record<string, number> = {};
    realized.forEach(r => {
        if (!r.date) return;
        const year = r.date.substring(0, 4);
        if (!acc[year]) acc[year] = 0;
        acc[year] += r.profit;
    });
    return acc;
  }, [realized]);

  const realizedGrouped = useMemo(() => {
    const sorted = [...realized].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const acc: Record<string, { items: Realized[]; sub: number }> = {};
    sorted.forEach((r) => { 
      if (!r.date) return;
      const m = r.date.substring(0, 7); 
      if (!acc[m]) acc[m] = { items: [], sub: 0 }; 
      acc[m].items.push(r); 
      acc[m].sub += r.profit; 
    });
    return acc;
  }, [realized]);

  if (!isClient) return <div className="min-h-screen bg-[#0c0e12]" />;

  return (
    <div className="min-h-screen bg-[#0c0e12] text-slate-200 p-4 md:p-8 font-sans relative">
      <div className="fixed inset-0 pointer-events-none opacity-20">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-rose-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-indigo-900/10 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-5xl mx-auto relative">
        <header className="mb-8 flex flex-wrap justify-between items-end border-b border-slate-800 pb-6 gap-4">
          <div>
            <h1 className="text-4xl font-black text-white italic tracking-tighter">MOM'S ASSET <span className="text-rose-500">MASTER</span></h1>
            <p className="text-slate-500 text-[10px] font-bold tracking-[0.3em] uppercase mt-1">FOR OUR DEAREST MOTHER · {lastUpdated}</p>
          </div>
          <button onClick={fetchAllData} disabled={loading} className={`text-[10px] px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${loading ? "bg-rose-900 text-rose-300 opacity-80" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
            <span className={loading ? "animate-spin" : ""}>↻</span> {syncStatusMsg}
          </button>
        </header>

        <nav className="flex gap-2 mb-10 overflow-x-auto pb-2 scrollbar-hide">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-5 py-3 rounded-2xl font-black text-[10px] tracking-widest uppercase transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === t.key ? "bg-rose-600 text-white shadow-lg" : "bg-slate-900 text-slate-500 hover:bg-slate-800"}`}>
              <span>{t.icon}</span> <span>{t.num}. {t.label}</span>
            </button>
          ))}
        </nav>

        {activeTab === "overview" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="bg-gradient-to-br from-rose-900/40 via-slate-900 to-slate-900 p-8 md:p-12 rounded-[40px] border border-rose-500/20 shadow-2xl">
              <div className="flex flex-wrap justify-between items-start gap-8">
                <div>
                  <p className="text-rose-400 text-[10px] font-black uppercase mb-3 opacity-80 tracking-widest">🏡 Current Net Worth</p>
                  <h2 className="text-5xl md:text-7xl font-black text-white tracking-tighter">{fmt(netWorth)}<span className="text-2xl font-light ml-2 opacity-30">KRW</span></h2>
                  <p className="text-slate-500 text-sm mt-2 font-mono">약 {fmtShort(netWorth)}원</p>
                </div>
                <div className="text-right bg-white/5 p-6 rounded-3xl border border-white/10 backdrop-blur">
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-2">🎯 Goal: {propertyGoal.name}</p>
                  <p className="text-2xl font-black text-white">{fmtShort(propertyGoal.price)}원</p>
                  <div className="w-full bg-slate-800 h-2 rounded-full mt-4 overflow-hidden">
                    <div className="bg-rose-500 h-full transition-all duration-1000" style={{ width: `${goalProgress}%` }} />
                  </div>
                  <p className="text-[10px] text-rose-400 font-bold mt-2">현재 달성률 {goalProgress.toFixed(1)}%</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="계좌 총액(예수금 포함)" value={`${fmtShort(totalStockVal)}원`} icon="💳" />
              <StatCard label="기타 자산" value={`${fmtShort(totalAssetsVal)}원`} icon="🏠" />
              <StatCard label="예적금" value={`${fmtShort(totalSavingsVal)}원`} variant="success" icon="🏦" />
              <StatCard label="부채 총계" value={`${fmtShort(totalDebtsVal)}원`} variant="danger" icon="💸" />
            </div>
          </div>
        )}

        {activeTab === "stocks" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {Object.keys(grouped).map((acc) => {
              const invested = grouped[acc].stockTotal - grouped[acc].profit;
              const totalRate = invested > 0 ? (grouped[acc].profit / invested) * 100 : 0;
              return (
                <Card key={acc} className="overflow-hidden">
                  <div className="px-6 py-5 bg-slate-800/40 border-b border-slate-800 flex justify-between items-center">
                    <span className="font-black text-white italic text-lg tracking-tight">💳 {acc}</span>
                    <div className="text-right">
                      <div className="text-white font-black text-xl">{fmt(grouped[acc].total)}원</div>
                      <div className="flex gap-2 text-[10px] font-bold justify-end mt-1">
                        <span className={pctColor(grouped[acc].dailyProfit)}>오늘 {pctSign(grouped[acc].dailyProfit)}{fmt(grouped[acc].dailyProfit)}원</span>
                        <span className="text-slate-500">|</span>
                        <span className={pctColor(grouped[acc].profit)}>누적 {pctSign(grouped[acc].profit)}{fmt(grouped[acc].profit)}원 ({totalRate.toFixed(1)}%)</span>
                      </div>
                    </div>
                  </div>
                  <table className="w-full text-left text-sm">
                    <tbody className="divide-y divide-slate-800/60">
                      {grouped[acc].items.map((s, i) => {
                        const isCash = s.name.includes("예수금") || s.name.includes("현금");
                        const rate = (s.market?.includes("해외") && !isCash) ? exchangeRate : 1;
                        const dailyAmt = s.dailyChange * rate * s.qty;
                        const profitAmt = (s.current - s.avg) * rate * s.qty;
                        const profitPct = s.avg > 0 ? ((s.current / s.avg) - 1) * 100 : 0;
                        
                        return (
                          <tr key={i} className="hover:bg-white/[0.02]">
                            <td className="px-6 py-4 font-bold text-slate-200">
                              {isCash ? (
                                  <span className="text-[10px] text-emerald-400 mr-2 uppercase">CASH</span>
                              ) : (
                                  <span className="text-[10px] text-rose-400 mr-2 uppercase">{s.market.includes("해외") ? "US" : "KR"}</span>
                              )}
                              {s.name}
                              {!isCash && <div className="text-[10px] text-slate-600 mt-1">{s.qty}주 · 평단 {s.market.includes("해외") ? `$${s.avg}` : fmt(s.avg)}</div>}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {isCash ? (
                                  <div className="font-black text-white">{fmt(s.current)}원</div>
                              ) : (
                                  <>
                                      <div className={`font-black ${pctColor(dailyAmt)}`}>오늘 {pctSign(dailyAmt)}{fmt(dailyAmt)}원</div>
                                      <div className={`text-[10px] opacity-80 mt-1 font-bold ${pctColor(profitAmt)}`}>수익 {pctSign(profitAmt)}{fmt(profitAmt)}원 ({profitPct.toFixed(1)}%)</div>
                                  </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              );
            })}
          </div>
        )}

        {activeTab === "realestate" && (
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-500">
             <Card className="p-8"><h3 className="text-xl font-black text-white italic mb-6">🏠 Real Assets</h3>
               <div className="space-y-3">{assets.map(a => (<div key={a.id} className="flex justify-between items-center bg-slate-950 p-4 rounded-2xl border border-slate-800"><span className="font-bold text-slate-300">{a.name}</span><span className="font-black text-rose-400">{fmt(a.value)}원</span></div>))}</div>
             </Card>
             <Card className="p-8 border-indigo-900/30 bg-indigo-900/10"><h3 className="text-xl font-black text-indigo-400 italic mb-6">💳 Liabilities</h3>
               <div className="space-y-3">{debts.map(d => (<div key={d.id} className="flex justify-between items-center bg-slate-950 p-4 rounded-2xl border border-indigo-900/20"><span className="font-bold text-slate-300">{d.name}</span><span className="font-black text-indigo-400">-{fmt(d.value)}원</span></div>))}</div>
             </Card>
           </div>
        )}

        {activeTab === "savings" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {savings.map((s) => {
              const maturity = new Date(s.maturityDate); const now = new Date();
              const mLeft = Math.max(0, (maturity.getFullYear() - now.getFullYear()) * 12 + (maturity.getMonth() - now.getMonth()));
              const fPrincipal = s.current + s.monthly * mLeft;
              const cInt = s.current * (s.interestRate / 100) * (mLeft / 12);
              const fInt = ((s.monthly * mLeft * (mLeft + 1)) / 2) * (s.interestRate / 100 / 12);
              const fVal = fPrincipal + cInt + fInt;
              return (
                <Card key={s.id} className="p-6">
                  <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-4">
                    <h3 className="text-xl font-black text-white italic">{s.name}</h3>
                    <span className="text-emerald-400 font-mono text-sm">만기까지 {mLeft}개월</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div><p className="text-[10px] text-slate-500 uppercase">현재 잔액</p><p className="font-bold">{fmt(s.current)}원</p></div>
                    <div><p className="text-[10px] text-slate-500 uppercase">금리</p><p className="font-bold text-emerald-400">{s.interestRate}%</p></div>
                    <div className="col-span-2 bg-emerald-950/40 p-4 rounded-2xl text-right">
                      <p className="text-[10px] text-emerald-400 uppercase font-black">만기 예상액</p>
                      <p className="text-xl font-black text-white">{fmt(fVal)}원</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {activeTab === "realized" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {Object.keys(yearlyRealized).sort((a, b) => Number(b) - Number(a)).map(year => (
                <Card key={year} className="p-6 bg-gradient-to-br from-indigo-950/40 to-slate-900 border-indigo-900/30">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2">📅 {year}년 누적 실현손익</p>
                  <p className={`text-3xl font-black tracking-tight ${yearlyRealized[year] >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {pctSign(yearlyRealized[year])}{fmt(yearlyRealized[year])}원
                  </p>
                </Card>
              ))}
            </div>

            {Object.keys(realizedGrouped).map((m) => (
              <Card key={m} className="overflow-hidden">
                <div className="px-6 py-4 bg-slate-800/40 flex justify-between items-center border-b border-slate-800">
                  <span className="font-black text-slate-300">{m} 결산</span>
                  <span className={`font-black ${realizedGrouped[m].sub >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{pctSign(realizedGrouped[m].sub)}{fmt(realizedGrouped[m].sub)}원</span>
                </div>
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-slate-800/60">
                    {realizedGrouped[m].items.map((r, i) => (
                      <tr key={i} className="hover:bg-white/[0.02]">
                        <td className="px-6 py-4 text-xs font-mono text-slate-500">{r.date?.substring(5)}</td>
                        <td className="px-6 py-4 font-bold">{r.name}</td>
                        <td className={`px-6 py-4 text-right font-black ${r.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{pctSign(r.profit)}{fmt(r.profit)}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        )}

        {activeTab === "goal" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <Card className="p-8 md:p-12 border-rose-900/30">
              <h3 className="text-2xl font-black text-white italic mb-8 flex items-center gap-3">
                🎯 부동산 목표 (고정값)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">목표 부동산 이름</label>
                    <div className="w-full bg-slate-950 text-white font-bold p-4 rounded-2xl border border-slate-700">{propertyGoal.name}</div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">목표 가격 (원)</label>
                    <div className="w-full bg-slate-950 text-white font-bold p-4 rounded-2xl border border-slate-700">{fmt(propertyGoal.price)}원</div>
                  </div>
                </div>
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-[32px] p-8 flex flex-col justify-center">
                  <p className="text-rose-400 text-xs font-black uppercase mb-2">구매까지 필요한 추가 금액</p>
                  <h4 className="text-4xl font-black text-white tracking-tighter">
                    {goalGap > 0 ? `${fmt(goalGap)} 원` : "목표 달성 완료! 🎉"}
                  </h4>
                  <p className="text-slate-500 text-sm mt-3 font-mono">약 {fmtShort(Math.max(0, goalGap))}원 더 모으면 {propertyGoal.name} 입성!</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        <footer className="mt-20 py-8 border-t border-slate-900 text-center">
          <p className="text-slate-800 text-[10px] font-black tracking-widest uppercase italic">MOM'S ASSET MASTER V2.4 · CREATED BY SON</p>
        </footer>
      </div>
    </div>
  );
}
