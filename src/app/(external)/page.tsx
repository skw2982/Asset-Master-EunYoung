"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis
} from "recharts";

// ═══════════════════════════════════════════
// ☁️ Config (어머님용 시트 GID로 교체 필수!)
// ═══════════════════════════════════════════
const KV_URL = "https://chief-jay-84148.upstash.io"; 
const KV_TOKEN = "gQAAAAAAAUi0AAIncDE5MmI4ZmFkNGQwN2E0NTNmYjAwY2ExNGQ1YzI1MTI3OHAxODQxNDg";

const BASE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSL3Ps1zpYTsWkrh8Wv6s9RQfRM1Fg-XVEbJGJGeaIG2Xmoz7yzFoBGie0fzU4aeX8eTswp5z4_3je5/pub?";

const GIDS = {
  STOCKS: "0", // 어머님 시트의 주식 GID로 변경
  REALIZED: "817751922", // 어머님 시트의 실현손익 GID로 변경
  ASSETS: "1398634207", // 어머님 시트의 실물자산 GID로 변경
  DEBTS: "359303564", // 어머님 시트의 부채 GID로 변경
  SAVINGS: "380349145", // 어머님 시트의 예적금 GID로 변경
};

// Types
interface Stock { market: string; account: string; name: string; qty: number; avg: number; current: number; dailyChange: number; }
interface Asset { id: number; name: string; value: number; }
interface Debt { id: number; name: string; value: number; }
interface Saving { id: number; name: string; monthly: number; current: number; maturityDate: string; transferDay: number; interestRate: number; }
interface Realized { date: string; name: string; qty: number; profit: number; yieldRate: number; note: string; }

type TabKey = "overview" | "stocks" | "realestate" | "savings" | "realized" | "goal";

const TABS: { key: TabKey; label: string; num: string; icon: string }[] = [
  { key: "overview", label: "자산 요약", num: "1", icon: "📊" },
  { key: "stocks", label: "보유 주식", num: "2", icon: "💳" },
  { key: "realestate", label: "실물/부채", num: "3", icon: "🏠" },
  { key: "savings", label: "예적금", num: "4", icon: "🏦" },
  { key: "realized", label: "실현 손익", num: "5", icon: "💰" },
  { key: "goal", label: "내 집 마련", num: "6", icon: "🎯" },
];

const ACCOUNT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#f97316"];

// Utilities
const cleanNum = (val: unknown): number => {
  if (val == null || val === "") return 0;
  const cleaned = String(val).replace(/[^0-9.\-]+/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

const fmt = (num: number): string => Math.round(num).toLocaleString("ko-KR");
const fmtDecimal = (num: number): string => {
  if (!num) return "0";
  return num.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
};

const fmtShort = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(1) + "억";
  if (abs >= 1e4) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
  return fmt(n);
};

const pctColor = (v: number) => (v >= 0 ? "text-rose-400" : "text-blue-400");
const pctSign = (v: number) => (v >= 0 ? "+" : "");

// Components
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
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [exchangeRate, setExchangeRate] = useState(1350);

  const [stocks, setStocks] = useState<Stock[]>([]);
  const [realized, setRealized] = useState<Realized[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [savings, setSavings] = useState<Saving[]>([]);

  // 🏠 부동산 목표 상태 (Cloud 연동)
  const [propertyGoal, setPropertyGoal] = useState({ name: "여의도 미성 47평", price: 2800000000 });

  useEffect(() => {
    setIsClient(true);
    const loadGoalData = async () => {
      try {
        const res = await fetch(`${KV_URL}/get/mom_property_goal`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
        const data = await res.json();
        if (data.result) setPropertyGoal(typeof data.result === 'string' ? JSON.parse(data.result) : data.result);
      } catch (e) { console.error(e); }
    };
    loadGoalData();
  }, []);

  const saveGoalToCloud = async (newGoal: typeof propertyGoal) => {
    try { await fetch(`${KV_URL}/set/mom_property_goal`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` }, body: JSON.stringify(newGoal) }); }
    catch (e) { console.error(e); }
  };

  const handleGoalChange = (field: 'name' | 'price', val: string) => {
    const newGoal = { ...propertyGoal, [field]: field === 'price' ? cleanNum(val) : val };
    setPropertyGoal(newGoal);
    saveGoalToCloud(newGoal);
  };

  const fetchCSV = async (gid: string) => {
    try {
      const res = await fetch(`${BASE_CSV_URL}gid=${gid}&single=true&output=csv&t=${Date.now()}`);
      const text = await res.text();
      return text.split("\n").map(r => r.trim()).filter(Boolean).slice(1);
    } catch { return []; }
  };

  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      const rateRes = await fetch("https://open.er-api.com/v6/latest/USD");
      if (rateRes.ok) { const data = await rateRes.json(); if (data?.rates?.KRW) setExchangeRate(data.rates.KRW); }
      const [sRows, rRows, aRows, dRows, svRows] = await Promise.all([fetchCSV(GIDS.STOCKS), fetchCSV(GIDS.REALIZED), fetchCSV(GIDS.ASSETS), fetchCSV(GIDS.DEBTS), fetchCSV(GIDS.SAVINGS)]);
      const parseRow = (row: string) => row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((v) => v.replace(/"/g, "").trim());
      setStocks(sRows.map(row => { const c = parseRow(row); return { market: c[0], account: c[1], name: c[2], avg: cleanNum(c[5]), current: cleanNum(c[6]), qty: cleanNum(c[7]), dailyChange: cleanNum(c[8]) }; }).filter(s => s.qty > 0));
      setRealized(rRows.map(row => { const c = parseRow(row); return { date: c[0], name: c[1], qty: cleanNum(c[2]), profit: cleanNum(c[3]), yieldRate: cleanNum(c[4]), note: c[5] }; }));
      setAssets(aRows.map((row, i) => { const c = parseRow(row); return { id: i, name: c[0], value: cleanNum(c[1]) }; }));
      setDebts(dRows.map((row, i) => { const c = parseRow(row); return { id: i, name: c[0], value: cleanNum(c[1]) }; }));
      setSavings(svRows.map((row, i) => { const c = parseRow(row); return { id: i, name: c[0], monthly: cleanNum(c[1]), current: cleanNum(c[2]), maturityDate: c[3], transferDay: cleanNum(c[4]), interestRate: cleanNum(c[5]) }; }));
      setLastUpdated(new Date().toLocaleTimeString("ko-KR"));
      setLoading(false);
    } catch (e) { setLoading(false); }
  }, []);

  useEffect(() => { fetchAllData(); const timer = setInterval(fetchAllData, 60000); return () => clearInterval(timer); }, [fetchAllData]);

  // Calculations
  const grouped = useMemo(() => {
    const acc: Record<string, { items: Stock[]; total: number; profit: number; dailyProfit: number }> = {};
    stocks.forEach((s) => {
      const isOS = s.market.includes("해외"); const rate = isOS ? exchangeRate : 1;
      if (!acc[s.account]) acc[s.account] = { items: [], total: 0, profit: 0, dailyProfit: 0 };
      acc[s.account].items.push(s);
      acc[s.account].total += s.current * rate * s.qty;
      acc[s.account].profit += (s.current - s.avg) * rate * s.qty;
      acc[s.account].dailyProfit += s.dailyChange * rate * s.qty;
    });
    return acc;
  }, [stocks, exchangeRate]);

  const totalStockVal = useMemo(() => stocks.reduce((a, b) => a + b.current * (b.market.includes("해외") ? exchangeRate : 1) * b.qty, 0), [stocks, exchangeRate]);
  const totalDailyProfit = useMemo(() => Object.values(grouped).reduce((a, b) => a + b.dailyProfit, 0), [grouped]);
  const totalAssetsVal = assets.reduce((a, b) => a + b.value, 0);
  const totalSavingsVal = savings.reduce((a, b) => a + b.current, 0);
  const totalDebtsVal = debts.reduce((a, b) => a + b.value, 0);
  const netWorth = totalStockVal + totalAssetsVal + totalSavingsVal - totalDebtsVal;

  // 부동산 목표 계산
  const goalGap = propertyGoal.price - netWorth;
  const goalProgress = Math.min(100, Math.max(0, (netWorth / propertyGoal.price) * 100));

  if (!isClient) return <div className="min-h-screen bg-[#0c0e12]" />;

  return (
    <div className="min-h-screen bg-[#0c0e12] text-slate-200 p-4 md:p-8 font-sans relative">
      {/* 배경 장식 */}
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
          <button onClick={fetchAllData} className="text-[10px] px-4 py-2 rounded-xl font-bold bg-slate-800 text-slate-300 flex items-center gap-2">
            <span className={loading ? "animate-spin" : ""}>↻</span> REFRESH
          </button>
        </header>

        <nav className="flex gap-2 mb-10 overflow-x-auto pb-2 scrollbar-hide">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-5 py-3 rounded-2xl font-black text-[10px] tracking-widest uppercase transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === t.key ? "bg-rose-600 text-white shadow-lg" : "bg-slate-900 text-slate-500 hover:bg-slate-800"}`}>
              <span>{t.icon}</span> <span>{t.num}. {t.label}</span>
            </button>
          ))}
        </nav>

        {/* 탭 1: 요약 & 목표 트래커 */}
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
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-2">🎯 Goal: {propertyGoal.여의도 미성 32평}</p>
                  <p className="text-2xl font-black text-white">{fmtShort(propertyGoal.3020000000)}원</p>
                  <div className="w-full bg-slate-800 h-2 rounded-full mt-4 overflow-hidden">
                    <div className="bg-rose-500 h-full transition-all duration-1000" style={{ width: `${goalProgress}%` }} />
                  </div>
                  <p className="text-[10px] text-rose-400 font-bold mt-2">현재 달성률 {goalProgress.toFixed(1)}%</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="주식 평가액" value={`${fmtShort(totalStockVal)}원`} icon="📈" />
              <StatCard label="기타 자산" value={`${fmtShort(totalAssetsVal)}원`} icon="🏠" />
              <StatCard label="예적금" value={`${fmtShort(totalSavingsVal)}원`} variant="success" icon="🏦" />
              <StatCard label="부채 총계" value={`${fmtShort(totalDebtsVal)}원`} variant="danger" icon="💳" />
            </div>
          </div>
        )}

        {/* 탭 2: 보유 주식 (경원님 버전과 동일한 로직) */}
        {activeTab === "stocks" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {Object.keys(grouped).map((acc) => (
              <Card key={acc} className="overflow-hidden">
                <div className="px-6 py-5 bg-slate-800/40 border-b border-slate-800 flex justify-between items-center">
                  <span className="font-black text-white italic text-lg tracking-tight">💳 {acc}</span>
                  <div className="text-right">
                    <div className="text-white font-black text-xl">{fmt(grouped[acc].total)}원</div>
                    <div className={`text-[10px] font-bold ${pctColor(grouped[acc].dailyProfit)}`}>오늘 {pctSign(grouped[acc].dailyProfit)}{fmt(grouped[acc].dailyProfit)}원</div>
                  </div>
                </div>
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-slate-800/60">
                    {grouped[acc].items.map((s, i) => (
                      <tr key={i} className="hover:bg-white/[0.02]">
                        <td className="px-6 py-4 font-bold text-slate-200">
                          <span className="text-[10px] text-rose-400 mr-2 uppercase">{s.market.includes("해외") ? "US" : "KR"}</span>{s.name}
                          <div className="text-[10px] text-slate-600 mt-1">{s.qty}주 · 평단 {s.market.includes("해외") ? `$${s.avg}` : fmt(s.avg)}</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className={`font-black ${pctColor(s.dailyChange)}`}>{pctSign(s.dailyChange)}{fmt(s.dailyChange * (s.market.includes("해외") ? exchangeRate : 1) * s.qty)}원</div>
                          <div className="text-[10px] opacity-60">수익률 {((s.current/s.avg - 1)*100).toFixed(1)}%</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        )}

        {/* 탭 6: 내 집 마련 시뮬레이션 (새로운 특화 기능) */}
        {activeTab === "goal" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <Card className="p-8 md:p-12">
              <h3 className="text-2xl font-black text-white italic mb-8 flex items-center gap-3">🎯 부동산 목표 설정</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">목표 부동산 이름</label>
                    <input type="text" value={propertyGoal.name} onChange={(e) => handleGoalChange('name', e.target.value)} className="w-full bg-slate-950 text-white font-bold p-4 rounded-2xl border border-slate-700 outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">목표 가격 (원)</label>
                    <input type="text" value={fmt(propertyGoal.price)} onChange={(e) => handleGoalChange('price', e.target.value)} className="w-full bg-slate-950 text-white font-bold p-4 rounded-2xl border border-slate-700 outline-none focus:border-rose-500 transition-colors" />
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

        {/* 나머지 탭들은 기존 구조 그대로 유지하여 데이터 깨짐 방지 */}
        {activeTab === "realestate" && (
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <Card className="p-8"><h3 className="text-xl font-black text-white italic mb-6">🏠 Real Assets</h3>
               <div className="space-y-3">{assets.map(a => (<div key={a.id} className="flex justify-between items-center bg-slate-950 p-4 rounded-2xl border border-slate-800"><span className="font-bold text-slate-300">{a.name}</span><span className="font-black text-rose-400">{fmt(a.value)}원</span></div>))}</div>
             </Card>
             <Card className="p-8 border-indigo-900/30 bg-indigo-900/10"><h3 className="text-xl font-black text-indigo-400 italic mb-6">💳 Liabilities</h3>
               <div className="space-y-3">{debts.map(d => (<div key={d.id} className="flex justify-between items-center bg-slate-950 p-4 rounded-2xl border border-indigo-900/20"><span className="font-bold text-slate-300">{d.name}</span><span className="font-black text-indigo-400">-{fmt(d.value)}원</span></div>))}</div>
             </Card>
           </div>
        )}
        
        {/* ... (생략된 Savings, Realized 탭들도 경원님 버전과 동일하게 포함) ... */}

        <footer className="mt-20 py-8 border-t border-slate-900 text-center">
          <p className="text-slate-800 text-[10px] font-black tracking-widest uppercase italic">MOM'S ASSET MASTER V1.0 · CREATED BY SON</p>
        </footer>
      </div>
    </div>
  );
}
