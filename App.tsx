
import React, { useState, useEffect, useCallback } from 'react';
import {
  Rss,
  Trash2,
  RefreshCw,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Code,
  LayoutDashboard,
  Loader2,
  Download,
  Zap,
  Plus,
  Settings,
  AlertTriangle,
  Info,
  Cpu,
  BarChart3
} from 'lucide-react';
import { scrapeProfile, generateUnifiedRSS } from './services/profileService';
import { MonitoredProfile, RSSItem } from './types';

import initialProfiles from './data/profiles.json';

const INITIAL_SEED: Omit<MonitoredProfile, 'id' | 'status' | 'items' | 'lastChecked'>[] = initialProfiles as Omit<MonitoredProfile, 'id' | 'status' | 'items' | 'lastChecked'>[];

const App: React.FC = () => {
  const [profiles, setProfiles] = useState<MonitoredProfile[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const [viewMode, setViewMode] = useState<'dashboard' | 'xml' | 'guide'>('dashboard');
  const [copied, setCopied] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('social2rss_v5_storage');
      if (saved) {
        setProfiles(JSON.parse(saved));
      } else {
        setProfiles(INITIAL_SEED.map(p => ({
          ...p,
          id: Math.random().toString(36).substr(2, 9),
          status: 'idle',
          lastChecked: null,
          items: []
        })));
      }
    } catch (e) {
      console.error("Storage load error", e);
    }
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (isReady) {
      localStorage.setItem('social2rss_v5_storage', JSON.stringify(profiles));
    }
  }, [profiles, isReady]);

  const performScan = async (id: string, url: string) => {
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, status: 'scanning' } : p));
    setGlobalError(null);

    try {
      const data = await scrapeProfile(url, selectedModel);
      setProfiles(prev => prev.map(p => p.id === id ? {
        ...p,
        name: data.title,
        status: 'success',
        lastChecked: new Date().toISOString(),
        items: data.items.map(item => ({ ...item, platform: p.platform }))
      } : p));
    } catch (err: any) {
      setProfiles(prev => prev.map(p => p.id === id ? { ...p, status: 'error' } : p));

      let errorMsg = "Hata oluştu.";
      if (err.message === "API_KEY_INVALID") errorMsg = "Geçersiz API Anahtarı!";
      if (err.message === "RATE_LIMIT_EXCEEDED") {
        errorMsg = "API Kotası Doldu! Lütfen 30-60 saniye bekleyin.";
      }

      setGlobalError(errorMsg);
    }
  };

  const syncAll = useCallback(async () => {
    if (isSyncing || profiles.length === 0) return;
    setIsSyncing(true);
    setSyncProgress({ current: 0, total: profiles.length });

    for (let i = 0; i < profiles.length; i++) {
      setSyncProgress(prev => ({ ...prev, current: i + 1 }));
      await performScan(profiles[i].id, profiles[i].url);

      // Kota güvenliği için araya boşluk koyuyoruz
      const delay = selectedModel.includes('pro') ? 15000 : 8000;
      if (i < profiles.length - 1) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
    setIsSyncing(false);
  }, [profiles, isSyncing, selectedModel]);

  const downloadRSS = () => {
    const xml = generateUnifiedRSS(allItems);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'social_feed.xml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isReady) return null;

  const allItems = profiles.flatMap(p => p.items).sort((a, b) =>
    new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  );

  const unifiedRSS = generateUnifiedRSS(allItems);

  return (
    <div className="min-h-screen bg-[#fcfdfe] flex flex-col font-sans text-slate-900">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-xl text-white shadow-lg shadow-emerald-100">
              <Rss size={20} />
            </div>
            <h1 className="text-sm font-bold tracking-tight">Social2RSS <span className="text-emerald-600">Pro</span></h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setSelectedModel('gemini-3-flash-preview')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5 ${selectedModel === 'gemini-3-flash-preview' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Cpu size={12} /> FLASH
              </button>
              <button
                onClick={() => setSelectedModel('gemini-3-pro-preview')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5 ${selectedModel === 'gemini-3-pro-preview' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Zap size={12} /> PRO
              </button>
            </div>

            <button
              onClick={syncAll}
              disabled={isSyncing}
              className={`px-4 py-2 rounded-xl text-[11px] font-bold flex items-center gap-2 transition-all border ${isSyncing ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-500 hover:text-emerald-600'
                }`}
            >
              {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {isSyncing ? `${syncProgress.current}/${syncProgress.total}` : 'Yenile'}
            </button>
            <button
              onClick={downloadRSS}
              className="px-4 py-2 rounded-xl text-[11px] font-bold flex items-center gap-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-100"
            >
              <Download size={14} /> XML
            </button>
          </div>
        </div>
      </header>

      {globalError && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-3 flex items-center justify-center gap-3 animate-in slide-in-from-top">
          <AlertTriangle size={16} className="text-amber-500" />
          <p className="text-amber-800 text-[11px] font-bold uppercase">{globalError}</p>
          <button onClick={() => setGlobalError(null)} className="text-amber-400 hover:text-amber-600 text-[10px] font-bold underline">Kapat</button>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[650px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Kaynaklar ({profiles.length})</h2>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
              {profiles.map(p => (
                <div key={p.id} className="group flex items-center gap-3 p-3 bg-slate-50/50 rounded-2xl border border-slate-100 hover:bg-white transition-all">
                  <div className={`w-2 h-2 rounded-full ${p.status === 'scanning' ? 'bg-emerald-500 animate-pulse' :
                      p.status === 'success' ? 'bg-green-500' :
                        p.status === 'error' ? 'bg-red-500' : 'bg-slate-300'
                    }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-700 truncate">{p.name}</p>
                    <p className="text-[9px] text-slate-400 truncate opacity-60">{p.url}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button onClick={() => performScan(p.id, p.url)} className="text-slate-400 hover:text-emerald-500 p-1"><RefreshCw size={12} /></button>
                    <button onClick={() => setProfiles(prev => prev.filter(x => x.id !== p.id))} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[650px]">
            <div className="flex bg-slate-50/50 p-1.5 border-b border-slate-100">
              <button onClick={() => setViewMode('dashboard')} className={`flex-1 py-2.5 text-[11px] font-bold rounded-xl flex items-center justify-center gap-2 ${viewMode === 'dashboard' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500'}`}>
                <LayoutDashboard size={14} /> Akış
              </button>
              <button onClick={() => setViewMode('xml')} className={`flex-1 py-2.5 text-[11px] font-bold rounded-xl flex items-center justify-center gap-2 ${viewMode === 'xml' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500'}`}>
                <Code size={14} /> XML
              </button>
              <button onClick={() => setViewMode('guide')} className={`flex-1 py-2.5 text-[11px] font-bold rounded-xl flex items-center justify-center gap-2 ${viewMode === 'guide' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500'}`}>
                <Settings size={14} /> Rehber
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              {viewMode === 'dashboard' ? (
                <div className="space-y-6">
                  {allItems.length > 0 ? allItems.map((item, i) => (
                    <article key={i} className="p-5 rounded-2xl border border-slate-50 hover:bg-slate-50/50 border-l-4 border-l-emerald-500 transition-all">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{item.platform}</span>
                        <span className="text-[10px] text-slate-400">{new Date(item.pubDate).toLocaleDateString('tr-TR')}</span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-[13px] mb-1.5">{item.title}</h4>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mb-3 leading-relaxed">{item.description}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400">{item.author}</span>
                        <a href={item.link} target="_blank" className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 hover:underline">PROFİLE GİT <ExternalLink size={10} /></a>
                      </div>
                    </article>
                  )) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-300 py-32 opacity-50">
                      <Clock size={48} className="mb-4" />
                      <p className="text-xs font-bold uppercase tracking-widest">Veri Bekleniyor</p>
                    </div>
                  )}
                </div>
              ) : viewMode === 'xml' ? (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">RSS 2.0 XML</span>
                    <button onClick={() => { navigator.clipboard.writeText(unifiedRSS); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="text-[10px] font-bold text-emerald-600">
                      {copied ? 'Kopyalandı' : 'Kopyala'}
                    </button>
                  </div>
                  <pre className="flex-1 p-5 bg-slate-900 text-emerald-400 text-[10px] rounded-2xl overflow-auto font-mono leading-relaxed shadow-inner">
                    <code>{unifiedRSS}</code>
                  </pre>
                </div>
              ) : (
                <div className="space-y-8">
                  <section>
                    <h3 className="font-bold text-sm mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-emerald-600" /> API Kota Bilgisi</h3>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Ücretsiz katmanda Google Arama (Search Grounding) özelliği dakikada yaklaşık <strong>1-2 isteğe</strong> izin verir.
                        Aynı kurumun hem LinkedIn hem Twitter hesabını takip etmek yerine sadece birini takip etmek kotalarınızı daha verimli kullanmanızı sağlar.
                      </p>
                      <ul className="text-[11px] text-slate-700 font-bold list-disc ml-4">
                        <li>Flash Modeli için 8 saniye</li>
                        <li>Pro Modeli için 15 saniye</li>
                      </ul>
                      <p className="text-[11px] text-slate-600">otomatik bekleme süresi uygulanır.</p>
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="py-6 text-center text-slate-400 border-t border-slate-100 text-[10px] font-medium tracking-widest uppercase">
        Social2RSS • Gemini AI Powered Social Tracking
      </footer>
    </div>
  );
};

export default App;
