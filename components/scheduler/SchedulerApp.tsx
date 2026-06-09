'use client';

// 근무 일지(scheduler) 메인 셸 — 원본 scheduler app/page.tsx(Home)을 그대로 이식.
// 4개 탭(주간 스케줄 / 근무 관리 / 직원 관리 / 통계 및 리포트)을 세그먼트 컨트롤로 전환.
// /admin 탭 안에 임베드되므로 헤더의 sticky 와 바깥 min-h-screen 만 임베드에 맞게 조정
// (사이트 Nav 와 sticky 충돌 방지). 나머지 UI/기능은 원본과 동일.
import { useState } from 'react';
import EmployeeManager from '@/components/scheduler/EmployeeManager';
import ScheduleManager from '@/components/scheduler/ScheduleManager';
import ReportView from '@/components/scheduler/ReportView';
import WeeklySchedule from '@/components/scheduler/WeeklySchedule';

type Tab = 'weekly' | 'schedule' | 'employees' | 'report';

export default function SchedulerApp() {
  const [activeTab, setActiveTab] = useState<Tab>('weekly');

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'weekly', label: '근무 스케줄', icon: '📅' },
    { id: 'schedule', label: '근무 리포트', icon: '⏰' },
    { id: 'employees', label: '직원 관리', icon: '👥' },
    { id: 'report', label: '근무 통계', icon: '📊' },
  ];

  return (
    <div className="min-h-fit bg-slate-50 text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-900 rounded-2xl overflow-hidden border border-slate-200">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md z-20 border-b border-slate-200">
        <div className="w-full px-3 sm:px-4">
          <div className="flex flex-col md:flex-row justify-between items-center py-4 gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-indigo-600">
                악센트 근무 일지 관리
              </h1>
              <p className="text-sm text-slate-500 font-medium mt-1">
                AC'SCENT ID & AC'SCENT WOW 매장 통합 시스템
              </p>
            </div>

            {/* Navigation - Segmented Control Style */}
            <nav className="flex p-1 space-x-1 bg-slate-100/80 rounded-xl" aria-label="Tabs">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all duration-200 ease-in-out
                      ${isActive
                        ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                      }
                    `}
                  >
                    <span className="text-base">{tab.icon}</span>
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full px-3 sm:px-4 py-6">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'weekly' && <WeeklySchedule />}
          {activeTab === 'schedule' && <ScheduleManager />}
          {activeTab === 'employees' && <EmployeeManager />}
          {activeTab === 'report' && <ReportView />}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 mt-auto">
        <div className="w-full px-3 py-6 sm:px-4">
          <div className="flex flex-col items-center justify-center text-center">
            <p className="text-sm text-slate-400 font-medium">
              © {new Date().getFullYear()} 악센트 근무 일지 관리 시스템. All rights reserved.
            </p>
            <p className="text-xs text-slate-300 mt-2">
              Designed for AC'SCENT
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
