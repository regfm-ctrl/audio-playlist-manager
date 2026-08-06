'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type OverviewSlot = { time: string; minuteOfDay: number; sponsors: string[] };
type WeeklyOverview = Record<string, OverviewSlot[]>;

const SPONSOR_COLORS = [
  { bg: '#0d3a5c', text: '#7ec3ff' },
  { bg: '#0d4a3a', text: '#6ee6c0' },
  { bg: '#4a2e0d', text: '#f2b872' },
  { bg: '#4a0d3a', text: '#f290d1' },
  { bg: '#2e0d4a', text: '#c090f2' },
  { bg: '#4a0d0d', text: '#f29090' },
];

export default function ScheduleOverviewPage() {
  const [overview, setOverview] = useState<WeeklyOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/schedule-overview')
      .then(res => res.ok ? res.json() : null)
      .then(data => { setOverview(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Stable color per sponsor name, derived from the full data set so the
  // same sponsor always gets the same color across the page
  const sponsorColorMap = new Map<string, { bg: string; text: string }>();
  if (overview) {
    const allSponsors = new Set<string>();
    for (const day of Object.values(overview)) {
      for (const slot of day) for (const s of slot.sponsors) allSponsors.add(s);
    }
    Array.from(allSponsors).sort().forEach((s, i) => {
      sponsorColorMap.set(s, SPONSOR_COLORS[i % SPONSOR_COLORS.length]);
    });
  }

  const IconBreaks = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/></svg>;
  const IconSchedule = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v3.5l2 1.5"/></svg>;
  const IconAdmin = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="2.5"/><path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg>;
  const IconCampaign = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8h2l2-5 4 10 2-5h2"/></svg>;
  const IconOverview = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="5.5" y1="2.5" x2="5.5" y2="4.5"/><line x1="10.5" y1="2.5" x2="10.5" y2="4.5"/></svg>;
  const IconAudit = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2l5.5 2.5v4c0 3.5-2.3 5.9-5.5 7-3.2-1.1-5.5-3.5-5.5-7v-4z"/><path d="M6 8l1.5 1.5L10.5 6.5"/></svg>;

  const S: Record<string, React.CSSProperties> = {
    app: { display: 'flex', height: '100vh', background: '#2a2a2c', fontFamily: 'var(--font-sans)', overflow: 'hidden' },
    sidebar: { width: 260, minWidth: 260, maxWidth: 260, background: '#2a2a2c', borderRight: '0.5px solid #3a3a3c', display: 'flex', flexDirection: 'column', flexShrink: 0 },
    main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f7', overflow: 'hidden' },
    navItem: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, marginBottom: 2, color: '#777', cursor: 'pointer', fontSize: 13, textDecoration: 'none' as const },
    navItemActive: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', background: '#0071e3', borderRadius: 8, marginBottom: 2, color: 'white', fontSize: 13, textDecoration: 'none' as const },
  };

  return (
    <div style={S.app}>
      <div style={S.sidebar}>
        <div style={{ padding: '12px 14px 10px', borderBottom: '0.5px solid #3a3a3c' }}>
          <img src="/regfm-logo.png" alt="REGFM" style={{ width: '100%', height: 'auto', borderRadius: 6, display: 'block' }} />
        </div>
        <div style={{ padding: '10px 8px 8px' }}>
          <span style={{ fontSize: 9, color: '#4a4a4c', padding: '0 6px', marginBottom: 5, letterSpacing: '0.1em', fontWeight: 600, display: 'block' }}>MENU</span>
          <a href="/" style={S.navItem}><IconBreaks /> Sponsorship Breaks</a>
          <a href="/schedules" style={S.navItem}><IconSchedule /> Schedules</a>
          <a href="/campaigns" style={S.navItem}><IconCampaign /> Campaigns</a>
          <a href="/schedule-overview" style={S.navItemActive}><IconOverview /> Weekly Overview</a>
          <a href="/audit" style={S.navItem}><IconAudit /> Audit</a>
          <a href="/admin" style={S.navItem}><IconAdmin /> Admin</a>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={S.main}>
        <div style={{ padding: '20px 28px', borderBottom: '0.5px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>Weekly Overview</h1>
            <p style={{ fontSize: 13, color: '#888', margin: '3px 0 0' }}>Every active campaign, combined across the week</p>
          </div>
          <a href="/api/schedule-overview/pdf" target="_blank" rel="noopener noreferrer"
            style={{ padding: '8px 16px', background: '#0071e3', color: 'white', borderRadius: 7, fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            Download PDF
          </a>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 className="animate-spin" size={24} color="#888" /></div>
          ) : !overview ? (
            <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>Couldn't load the schedule overview.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 12 }}>
              {DAY_NAMES.map((dayName, dayIdx) => {
                const slots = overview[String(dayIdx)] || [];
                return (
                  <div key={dayIdx} style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 12, minHeight: 200 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 8px', color: '#1a1a1a' }}>{dayName}</p>
                    {slots.length === 0 ? (
                      <p style={{ fontSize: 12, color: '#bbb', margin: 0 }}>Nothing scheduled</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {slots.map((slot, i) => (
                          <div key={i} style={{ borderTop: i === 0 ? undefined : '0.5px solid #eee', paddingTop: i === 0 ? 0 : 6 }}>
                            <p style={{ fontSize: 11, color: '#888', margin: '0 0 3px' }}>{slot.time}</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {slot.sponsors.map(s => {
                                const color = sponsorColorMap.get(s) || { bg: '#333', text: '#ccc' };
                                return (
                                  <span key={s} style={{ fontSize: 11, background: color.bg, color: color.text, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap' }}>{s}</span>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
