'use client';

import { useState, useEffect, useRef } from 'react';
import { Employee, WorkSchedule } from '@/lib/scheduler/types';
import { storage } from '@/lib/scheduler/storage';
import { initialEmployees } from '@/lib/scheduler/employees';
import { calculateHours, calculatePay } from '@/lib/scheduler/calculations';
import { listEvents } from '@/lib/db';
import type { CalendarEvent } from '@/lib/types';
import html2canvas from 'html2canvas';

interface CellSchedule {
  employeeName: string;
  employeeId: string;
  startTime: string;
  endTime: string;
  notes?: string;
  store: 'accent-id' | 'accent-wow';
}

interface DaySchedule {
  date: string;
  dayOfWeek: string;
  schedules: CellSchedule[];
}

interface WeekNotes {
  [date: string]: {
    eventId?: string;
    eventWow?: string;
    noteId?: string;
    noteWow?: string;
  };
}

// Helper function to get local date string (YYYY-MM-DD)
const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper function to get Monday of current week
const getMondayOfWeek = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};

export default function WeeklySchedule() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [weekDates, setWeekDates] = useState<DaySchedule[]>([]);
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(new Date());
  const [editingCell, setEditingCell] = useState<{ date: string; employeeId: string } | null>(null);
  const [monthYear, setMonthYear] = useState<string>('');
  const [weekNotes, setWeekNotes] = useState<WeekNotes>({});
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // 생일 이벤트 탭(events 컬렉션)에서 등록된 이벤트 — 현재 주 범위. EVENT 행에 읽기전용 표시.
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>([]);
  const scheduleRef = useRef<HTMLDivElement>(null);

  // 현재 주(월~일) 범위의 생일 이벤트 로드 (주 이동 시마다)
  useEffect(() => {
    let cancelled = false;
    const monday = getMondayOfWeek(currentWeekStart);
    const start = getLocalDateString(monday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const end = getLocalDateString(sunday);
    listEvents({ from: start, to: end })
      .then((rows) => {
        if (!cancelled) setWeekEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setWeekEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentWeekStart]);

  // 특정 날짜·매장(id/wow)에 해당하는 등록 이벤트(공통 'all' 포함)
  const eventsForDay = (date: string, store: 'id' | 'wow'): CalendarEvent[] =>
    weekEvents.filter(
      (e) =>
        (e.store === store || e.store === 'all') &&
        date >= e.startDate &&
        date <= e.endDate
    );

  useEffect(() => {
    const initializeWeek = async () => {
      // 클라이언트에서만 실행 - 주간 날짜 초기화
      const initWeek = getMondayOfWeek(new Date());
      setCurrentWeekStart(initWeek);

      // 월/주차 텍스트 설정 (목요일 기준)
      const thursday = new Date(initWeek);
      thursday.setDate(initWeek.getDate() + 3);
      const month = thursday.getMonth() + 1;

      // 목요일이 속한 월 기준으로 주차 계산
      const firstDayOfThursdayMonth = new Date(thursday.getFullYear(), thursday.getMonth(), 1);
      const dayOfWeek = firstDayOfThursdayMonth.getDay();
      const daysUntilFirstThursday = (4 - dayOfWeek + 7) % 7;
      const firstThursday = new Date(firstDayOfThursdayMonth);
      firstThursday.setDate(1 + daysUntilFirstThursday);
      const diffTime = thursday.getTime() - firstThursday.getTime();
      const weekNumber = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000)) + 1;

      setMonthYear(`${month}월 ${weekNumber}주차`);

      try {
        // 직원 데이터 로드
        let savedEmployees = await storage.getEmployees();
        if (savedEmployees.length === 0) {
          await storage.saveEmployees(initialEmployees);
          savedEmployees = initialEmployees;
        }
        setEmployees(savedEmployees);

        // 초기 7일 날짜 배열 생성
        const weekKey = getLocalDateString(initWeek);
        const dates: DaySchedule[] = [];
        const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
        for (let i = 0; i < 7; i++) {
          const date = new Date(initWeek);
          date.setDate(initWeek.getDate() + i);
          dates.push({
            date: getLocalDateString(date),
            dayOfWeek: dayNames[i],
            schedules: [],
          });
        }

        // 주간 스케줄에서 먼저 로드 시도
        const savedWeekSchedules = await storage.getWeekSchedules(weekKey);

        // schedules 컬렉션에서도 해당 주의 데이터 로드
        const allSchedules = await storage.getSchedules();
        const weekEnd = new Date(initWeek);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekEndStr = getLocalDateString(weekEnd);

        const weekSchedulesFromMain = allSchedules.filter(s =>
          s.date >= weekKey && s.date <= weekEndStr
        );

        // 1. weekSchedules 컬렉션에서 로드
        if (savedWeekSchedules && savedWeekSchedules.dates && Array.isArray(savedWeekSchedules.dates)) {
          savedWeekSchedules.dates.forEach((savedDay: DaySchedule) => {
            const dateIndex = dates.findIndex(d => d.date === savedDay.date);
            if (dateIndex !== -1 && savedDay.schedules) {
              dates[dateIndex].schedules = savedDay.schedules;
            }
          });
        }

        // 2. schedules 컬렉션에서 추가 데이터 병합 (weekSchedules에 없는 것만)
        weekSchedulesFromMain.forEach(schedule => {
          const dateIndex = dates.findIndex(d => d.date === schedule.date);
          if (dateIndex !== -1) {
            const employee = savedEmployees.find(e => e.id === schedule.employeeId);
            const existingSchedule = dates[dateIndex].schedules.find(
              s => s.employeeId === schedule.employeeId && s.store === schedule.store
            );

            if (!existingSchedule && employee) {
              dates[dateIndex].schedules.push({
                employeeName: employee.name,
                employeeId: schedule.employeeId,
                startTime: schedule.startTime,
                endTime: schedule.endTime,
                store: schedule.store,
              });
            }
          }
        });

        // 한 번에 설정
        setWeekDates(dates);

        // 주간 노트 로드
        const savedNotes = await storage.getWeekNotes(weekKey);
        if (savedNotes) {
          setWeekNotes(savedNotes);
        }
      } catch (error) {
        console.error('Failed to load initial data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeWeek();
  }, []);

  const getMonday = (date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  };

  const generateWeekDates = async (startDate: Date) => {
    const weekKey = getLocalDateString(startDate);

    // 먼저 기본 날짜 배열 생성 (항상 7일 생성)
    const dates: DaySchedule[] = [];
    const dayNames = ['월', '화', '수', '목', '금', '토', '일'];

    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);

      dates.push({
        date: getLocalDateString(date),
        dayOfWeek: dayNames[i],
        schedules: [],
      });
    }

    // 저장된 스케줄이 있으면 병합
    try {
      // 1. weekSchedules 컬렉션에서 로드
      const savedWeekSchedules = await storage.getWeekSchedules(weekKey);
      if (savedWeekSchedules && savedWeekSchedules.dates && Array.isArray(savedWeekSchedules.dates)) {
        savedWeekSchedules.dates.forEach((savedDay: DaySchedule) => {
          const dateIndex = dates.findIndex(d => d.date === savedDay.date);
          if (dateIndex !== -1 && savedDay.schedules) {
            dates[dateIndex].schedules = savedDay.schedules;
          }
        });
      }

      // 2. schedules 컬렉션에서도 해당 주의 데이터 로드 및 병합
      const allSchedules = await storage.getSchedules();
      const weekEnd = new Date(startDate);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const weekEndStr = getLocalDateString(weekEnd);

      const weekSchedulesFromMain = allSchedules.filter(s =>
        s.date >= weekKey && s.date <= weekEndStr
      );

      weekSchedulesFromMain.forEach(schedule => {
        const dateIndex = dates.findIndex(d => d.date === schedule.date);
        if (dateIndex !== -1) {
          const employee = employees.find(e => e.id === schedule.employeeId);
          const existingSchedule = dates[dateIndex].schedules.find(
            s => s.employeeId === schedule.employeeId && s.store === schedule.store
          );

          if (!existingSchedule && employee) {
            dates[dateIndex].schedules.push({
              employeeName: employee.name,
              employeeId: schedule.employeeId,
              startTime: schedule.startTime,
              endTime: schedule.endTime,
              store: schedule.store,
            });
          }
        }
      });
    } catch (error) {
      console.error('Failed to load saved schedules:', error);
    }

    // 항상 날짜 배열 설정 (빈 스케줄이라도)
    setWeekDates(dates);

    // 해당 주의 목요일 기준으로 월 결정
    const thursday = new Date(startDate);
    thursday.setDate(startDate.getDate() + 3); // 월요일 + 3 = 목요일
    const month = thursday.getMonth() + 1;
    const weekNumber = getWeekNumber(startDate);
    setMonthYear(`${month}월 ${weekNumber}주차`);

    // 해당 주의 노트 불러오기
    try {
      const savedNotes = await storage.getWeekNotes(weekKey);
      if (savedNotes) {
        setWeekNotes(savedNotes);
      } else {
        setWeekNotes({});
      }
    } catch (error) {
      console.error('Failed to load week notes:', error);
      setWeekNotes({});
    }
  };

  const getWeekNumber = (date: Date): number => {
    // 해당 주의 목요일 기준으로 월/주차 결정
    const thursday = new Date(date);
    thursday.setDate(date.getDate() + (4 - (date.getDay() || 7)));

    // 목요일이 속한 월의 1일
    const year = thursday.getFullYear();
    const month = thursday.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);

    // 해당 월 1일의 목요일 찾기
    const firstThursday = new Date(firstDayOfMonth);
    const dayOfWeek = firstDayOfMonth.getDay();
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
    firstThursday.setDate(1 + daysUntilThursday);

    // 첫 번째 목요일부터 현재 목요일까지의 주 차이 계산
    const diffTime = thursday.getTime() - firstThursday.getTime();
    const diffWeeks = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000));

    return diffWeeks + 1;
  };

  const handlePrevWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() - 7);
    setCurrentWeekStart(newStart);
    generateWeekDates(newStart);
  };

  const handleNextWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() + 7);
    setCurrentWeekStart(newStart);
    generateWeekDates(newStart);
  };

  const handleGoToToday = () => {
    const today = new Date();
    const newStart = getMondayOfWeek(today);
    setCurrentWeekStart(newStart);
    generateWeekDates(newStart);
  };

  const handleAddSchedule = async (date: string, employeeId: string, startTime: string, endTime: string, notes?: string, store?: 'accent-id' | 'accent-wow') => {
    const daySchedule = weekDates.find(d => d.date === date);
    const employee = employees.find(e => e.id === employeeId);

    if (daySchedule && employee) {
      const storeValue = store || employee.store || 'accent-id';
      const existingIndex = daySchedule.schedules.findIndex(s => s.employeeId === employeeId && s.store === storeValue);

      const scheduleData = {
        employeeName: employee.name,
        employeeId,
        startTime,
        endTime,
        notes,
        store: storeValue as 'accent-id' | 'accent-wow',
      };

      if (existingIndex >= 0) {
        daySchedule.schedules[existingIndex] = scheduleData;
      } else {
        daySchedule.schedules.push(scheduleData);
      }

      // 업데이트된 weekDates로 새 배열 생성
      const updatedWeekDates = weekDates.map(d =>
        d.date === date ? { ...d, schedules: [...daySchedule.schedules] } : d
      );
      setWeekDates(updatedWeekDates);

      // schedules 컬렉션에 저장하기 전에, 기존에 다른 ID로 저장된 스케줄이 있으면 삭제
      // (ScheduleManager에서 만든 스케줄은 timestamp ID를 사용하므로)
      const allSchedules = await storage.getSchedules();

      // 같은 날짜, 같은 직원의 모든 스케줄 찾기 (store가 같거나, 기존 스케줄에 store가 없는 경우 포함)
      const matchingSchedules = allSchedules.filter(s =>
        s.date === date &&
        s.employeeId === employeeId &&
        (s.store === storeValue || !s.store || s.store === undefined)
      );

      // 새로 저장할 ID가 아닌 기존 스케줄 모두 삭제
      const newId = `${date}_${employeeId}_${storeValue}`;
      for (const existingSchedule of matchingSchedules) {
        if (existingSchedule.id !== newId) {
          console.log('Deleting old schedule:', existingSchedule.id);
          await storage.deleteSchedule(existingSchedule.id);
        }
      }

      // schedules 컬렉션에 저장
      const hours = calculateHours(startTime, endTime);
      const pay = calculatePay(hours, employee.hourlyWage);

      const workSchedule: WorkSchedule = {
        id: `${date}_${employeeId}_${storeValue}`,
        employeeId,
        date,
        startTime,
        endTime,
        store: storeValue as 'accent-id' | 'accent-wow',
        hours,
        pay,
      };

      await storage.addSchedule(workSchedule);

      // weekSchedules 컬렉션에도 저장 (undefined 제거, 업데이트된 데이터 사용)
      // date에서 직접 월요일을 계산 (currentWeekStart 상태 대신)
      const scheduleDate = new Date(date);
      const monday = getMonday(scheduleDate);
      const weekKey = getLocalDateString(monday);
      const cleanDates = updatedWeekDates.map(day => ({
        ...day,
        schedules: day.schedules.map(s => ({
          employeeName: s.employeeName,
          employeeId: s.employeeId,
          startTime: s.startTime,
          endTime: s.endTime,
          store: s.store,
          ...(s.notes && { notes: s.notes })
        }))
      }));
      await storage.saveWeekSchedules(weekKey, { dates: cleanDates });
    }
    setEditingCell(null);
  };

  const handleDeleteSchedule = async (date: string, employeeId: string, store?: 'accent-id' | 'accent-wow') => {
    const daySchedule = weekDates.find(d => d.date === date);
    if (daySchedule) {
      // 해당 스케줄 찾기
      const scheduleToDelete = daySchedule.schedules.find(s => s.employeeId === employeeId && (!store || s.store === store));

      // UI에서 제거
      daySchedule.schedules = daySchedule.schedules.filter(s => !(s.employeeId === employeeId && (!store || s.store === store)));
      setWeekDates([...weekDates]);

      // schedules 컬렉션에서 삭제 - 다른 ID 형식으로 저장된 경우도 처리
      if (scheduleToDelete) {
        const storeValue = scheduleToDelete.store;
        const expectedId = `${date}_${employeeId}_${storeValue}`;

        // 먼저 예상 ID로 삭제 시도
        await storage.deleteSchedule(expectedId);

        // 다른 ID로 저장된 스케줄도 찾아서 삭제
        const allSchedules = await storage.getSchedules();
        const matchingSchedule = allSchedules.find(s =>
          s.date === date &&
          s.employeeId === employeeId &&
          s.store === storeValue
        );
        if (matchingSchedule && matchingSchedule.id !== expectedId) {
          await storage.deleteSchedule(matchingSchedule.id);
        }
      }

      // weekSchedules 컬렉션에도 업데이트 (undefined 제거)
      const scheduleDate = new Date(date);
      const monday = getMonday(scheduleDate);
      const weekKey = getLocalDateString(monday);
      const cleanDates = weekDates.map(day => ({
        ...day,
        schedules: day.schedules.map(s => ({
          employeeName: s.employeeName,
          employeeId: s.employeeId,
          startTime: s.startTime,
          endTime: s.endTime,
          store: s.store,
          ...(s.notes && { notes: s.notes })
        }))
      }));
      await storage.saveWeekSchedules(weekKey, { dates: cleanDates });
    }
    setEditingCell(null);
  };

  const handleCapture = async () => {
    if (!scheduleRef.current) return;

    try {
      const canvas = await html2canvas(scheduleRef.current, {
        backgroundColor: '#f8fafc', // slate-50
        scale: 2,
      });

      const link = document.createElement('a');
      link.download = `스케줄_${monthYear}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (error) {
      console.error('캡쳐 실패:', error);
      alert('캡쳐에 실패했습니다.');
    }
  };

  const handleSaveNotes = async () => {
    const weekKey = getLocalDateString(currentWeekStart);

    // Firestore에 주간 노트 및 스케줄 저장 (undefined 제거)
    await storage.saveWeekNotes(weekKey, weekNotes);

    const cleanDates = weekDates.map(day => ({
      ...day,
      schedules: day.schedules.map(s => ({
        employeeName: s.employeeName,
        employeeId: s.employeeId,
        startTime: s.startTime,
        endTime: s.endTime,
        store: s.store,
        ...(s.notes && { notes: s.notes })
      }))
    }));
    await storage.saveWeekSchedules(weekKey, { dates: cleanDates });

    // 근무 관리 시스템과 연동: storage에 스케줄 저장
    const existingSchedules = await storage.getSchedules();

    for (const day of weekDates) {
      for (const schedule of day.schedules) {
        const employee = employees.find(e => e.id === schedule.employeeId);
        if (!employee) continue;

        const hours = calculateHours(schedule.startTime, schedule.endTime);
        const pay = calculatePay(hours, employee.hourlyWage);

        // 기존 스케줄 확인 (같은 날짜, 같은 직원, 같은 매장)
        const existingSchedule = existingSchedules.find(
          s => s.date === day.date && s.employeeId === schedule.employeeId && s.store === schedule.store
        );

        const workSchedule: WorkSchedule = {
          id: existingSchedule?.id || `${day.date}_${schedule.employeeId}_${schedule.store}`,
          employeeId: schedule.employeeId,
          date: day.date,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          store: schedule.store,
          hours,
          pay,
        };

        if (existingSchedule) {
          await storage.updateSchedule(existingSchedule.id, workSchedule);
        } else {
          await storage.addSchedule(workSchedule);
        }
      }
    }

    setIsEditingNotes(false);
    alert('저장되었습니다.');
  };

  const handleNoteChange = (date: string, field: 'eventId' | 'eventWow' | 'noteId' | 'noteWow', value: string) => {
    setWeekNotes(prev => ({
      ...prev,
      [date]: {
        ...prev[date],
        [field]: value,
      },
    }));
  };

  const formatDateDisplay = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  if (isLoading) {
    return (
      <div className="bg-slate-50 dark:bg-slate-900 rounded-xl shadow-sm p-6 border border-slate-200 dark:border-slate-800">
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-slate-500 font-medium animate-pulse">데이터를 불러오는 중입니다...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-fit p-2 md:p-4 font-sans text-slate-800">
      <div className="max-w-[1600px] mx-auto bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">

        {/* 헤더 컨트롤 영역 */}
        <div className="p-3 border-b border-slate-100 bg-white flex-shrink-0">
          <div className="flex flex-col md:flex-row justify-between items-center gap-2">
            <h2 className="text-2xl font-bold text-slate-800 bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-indigo-600">
              {monthYear} 스케줄
            </h2>

            <div className="flex flex-wrap gap-2 justify-center md:justify-end w-full md:w-auto">
              <div className="flex bg-slate-100 p-0.5 rounded-lg">
                <button
                  onClick={handlePrevWeek}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white rounded-md transition-all"
                >
                  ← 이전 주
                </button>
                <div className="w-px bg-slate-300 my-1.5 mx-0.5"></div>
                <button
                  onClick={handleGoToToday}
                  className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-all"
                >
                  오늘
                </button>
                <div className="w-px bg-slate-300 my-1.5 mx-0.5"></div>
                <button
                  onClick={handleNextWeek}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white rounded-md transition-all"
                >
                  다음 주 →
                </button>
              </div>

              <div className="flex gap-1.5">
                <button
                  onClick={handleCapture}
                  className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border border-indigo-200"
                >
                  <span>📷</span> 캡쳐
                </button>

                {!isEditingNotes ? (
                  <button
                    onClick={() => setIsEditingNotes(true)}
                    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  >
                    <span>✏️</span> 편집 모드
                  </button>
                ) : (
                  <button
                    onClick={handleSaveNotes}
                    className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all animate-pulse-slow"
                  >
                    <span>💾</span> 변경사항 저장
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 스케줄 테이블 영역 */}
        <div ref={scheduleRef} className="overflow-x-auto bg-white">
          <table className="w-full border-collapse" style={{ minWidth: '1000px' }}>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="p-2 w-20 text-center font-bold text-slate-500 text-xs uppercase tracking-wider sticky left-0 bg-slate-50 z-10 border-r border-slate-200 align-middle">
                  <div className="flex flex-col items-center justify-center leading-tight">
                    <span className="text-[9px] text-slate-400 font-medium">{currentWeekStart.getFullYear()}년</span>
                    <span className="text-[10px]">{monthYear}</span>
                  </div>
                </th>
                {weekDates.map((day) => (
                  <th
                    key={day.date}
                    className={`p-2 text-center border-r border-slate-100 last:border-r-0 w-[120px] transition-colors
                      ${day.dayOfWeek === '토' ? 'text-blue-600 bg-blue-50/30' : ''}
                      ${day.dayOfWeek === '일' ? 'text-rose-600 bg-rose-50/30' : ''}
                    `}
                  >
                    <div className="flex flex-col items-center">
                      <span className="text-xs font-medium opacity-80">{formatDateDisplay(day.date)}</span>
                      <span className="text-base font-bold">{day.dayOfWeek}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">

              {/* 구분선: Accent ID */}
              <tr className="bg-slate-50/80">
                <td colSpan={8} className="py-1 px-3 border-l-4 border-indigo-500 bg-indigo-50/50">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                    <span className="font-bold text-indigo-900 text-xs tracking-wide">AC'SCENT ID (아이디)</span>
                  </div>
                </td>
              </tr>

              {/* ID EVENT Row */}
              <tr className="group hover:bg-slate-50/50 transition-colors">
                <td className="p-1.5 text-[10px] font-bold text-slate-500 text-center bg-slate-50 border-r border-slate-200 sticky left-0 z-10">EVENT</td>
                {weekDates.map((day) => (
                  <td key={day.date} className="p-1 border-r border-slate-100 last:border-r-0 align-top">
                    <div className="space-y-0.5">
                      {/* 생일 이벤트 탭에서 등록된 이벤트 (읽기 전용) */}
                      {eventsForDay(day.date, 'id').map((e) => (
                        <div
                          key={e.id}
                          className="flex items-center gap-1 rounded bg-white border border-slate-200 px-1 py-0.5"
                          title={e.title}
                        >
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: e.color || '#7c5cff' }}
                          />
                          <span className="truncate text-[9px] font-medium text-slate-700">
                            {e.title}
                            {e.store === 'all' ? ' (공통)' : ''}
                          </span>
                        </div>
                      ))}
                      {/* 주간 메모(EVENT) — 편집 가능 */}
                      {isEditingNotes ? (
                        <textarea
                          value={weekNotes[day.date]?.eventId || ''}
                          onChange={(e) => handleNoteChange(day.date, 'eventId', e.target.value)}
                          className="w-full p-1 text-[10px] border border-slate-200 rounded bg-white focus:ring-1 focus:ring-indigo-500 focus:border-transparent outline-none transition-all resize-none"
                          placeholder="이벤트..."
                          rows={1}
                        />
                      ) : weekNotes[day.date]?.eventId ? (
                        <div className="p-1 text-[10px] text-slate-600 bg-slate-50/50 rounded">
                          {weekNotes[day.date]?.eventId}
                        </div>
                      ) : null}
                    </div>
                  </td>
                ))}
              </tr>

              {/* ID Staff Schedule Row */}
              {weekDates.map((day, idx) => {
                if (idx !== 0) return null;
                return (
                  <tr key={`id-${day.date}`}>
                    <td className="p-1.5 text-center bg-white border-r border-slate-200 sticky left-0 z-10">
                      <div className="flex flex-col items-center justify-center h-full">
                        <span className="font-bold text-slate-700 text-[10px]">STAFF</span>
                      </div>
                    </td>
                    {weekDates.map((d) => {
                      const schedules = d.schedules.filter(s => s.store === 'accent-id');
                      return (
                        <td key={d.date} className="p-1 border-r border-slate-100 last:border-r-0 align-top h-[100px]">
                          <div className="flex flex-col gap-1 h-full">
                            {isEditingNotes && (
                              <div className="mb-1">
                                <select
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleAddSchedule(d.date, e.target.value, '12:30', '19:30', undefined, 'accent-id');
                                      e.target.value = '';
                                    }
                                  }}
                                  className="w-full text-[10px] py-1.5 px-1 border-2 border-dashed border-indigo-400 rounded bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100 hover:border-indigo-500 transition-colors cursor-pointer outline-none appearance-none text-center"
                                  style={{ backgroundImage: 'none' }}
                                >
                                  <option value="">+ 추가</option>
                                  {employees
                                    .filter(emp => !schedules.find(s => s.employeeId === emp.id))
                                    .map(emp => (
                                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                                    ))}
                                </select>
                              </div>
                            )}
                            {schedules.map((schedule) => {
                              const isEditing = editingCell?.date === d.date && editingCell?.employeeId === schedule.employeeId;

                              if (isEditing) {
                                return (
                                  <ScheduleEditCell
                                    key={schedule.employeeId}
                                    employeeName={schedule.employeeName}
                                    employeeId={schedule.employeeId}
                                    schedule={schedule}
                                    onSave={(start, end, notes) => handleAddSchedule(d.date, schedule.employeeId, start, end, notes, 'accent-id')}
                                    onCancel={() => setEditingCell(null)}
                                    onDelete={() => handleDeleteSchedule(d.date, schedule.employeeId, 'accent-id')}
                                    defaultStartTime="12:30"
                                    defaultEndTime="19:30"
                                  />
                                );
                              }

                              return (
                                <div
                                  key={schedule.employeeId}
                                  onClick={() => isEditingNotes && setEditingCell({ date: d.date, employeeId: schedule.employeeId })}
                                  className={`group relative p-1.5 bg-white border-l-2 border-indigo-400 rounded-r shadow-sm transition-all ring-1 ring-slate-100 ${isEditingNotes ? 'hover:shadow cursor-pointer' : ''}`}
                                >
                                  <div className="flex justify-between items-start">
                                    <span className="font-bold text-[11px] text-slate-800">{schedule.employeeName}</span>
                                  </div>
                                  <div className="text-[9px] font-medium text-indigo-600 bg-indigo-50 inline-block px-1 py-0.5 rounded mt-0.5">
                                    {schedule.startTime}-{schedule.endTime}
                                  </div>
                                  {schedule.notes && (
                                    <div className="text-[9px] text-slate-500 leading-tight truncate mt-0.5">
                                      {schedule.notes}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* ID Note Row */}
              <tr className="group hover:bg-slate-50/50 transition-colors">
                <td className="p-1.5 text-[10px] font-bold text-slate-500 text-center bg-slate-50 border-r border-slate-200 sticky left-0 z-10">비고</td>
                {weekDates.map((day) => (
                  <td key={day.date} className="p-1 border-r border-slate-100 last:border-r-0 align-top">
                    {isEditingNotes ? (
                      <textarea
                        value={weekNotes[day.date]?.noteId || ''}
                        onChange={(e) => handleNoteChange(day.date, 'noteId', e.target.value)}
                        className="w-full p-1 text-[10px] border border-slate-200 rounded bg-white focus:ring-1 focus:ring-indigo-500 focus:border-transparent outline-none transition-all resize-none"
                        placeholder="비고..."
                        rows={1}
                      />
                    ) : (
                      <div className="min-h-[16px] p-1 text-[10px] text-slate-500 italic bg-slate-50/30 rounded">
                        {weekNotes[day.date]?.noteId}
                      </div>
                    )}
                  </td>
                ))}
              </tr>

              {/* 구분선: Accent WOW */}
              <tr className="bg-slate-50/80">
                <td colSpan={8} className="py-1 px-3 border-l-4 border-emerald-500 bg-emerald-50/50">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span className="font-bold text-emerald-900 text-xs tracking-wide">AC'SCENT WOW (와우)</span>
                  </div>
                </td>
              </tr>

              {/* WOW EVENT Row */}
              <tr className="group hover:bg-slate-50/50 transition-colors">
                <td className="p-1.5 text-[10px] font-bold text-slate-500 text-center bg-slate-50 border-r border-slate-200 sticky left-0 z-10">EVENT</td>
                {weekDates.map((day) => (
                  <td key={day.date} className="p-1 border-r border-slate-100 last:border-r-0 align-top">
                    <div className="space-y-0.5">
                      {/* 생일 이벤트 탭에서 등록된 이벤트 (읽기 전용) */}
                      {eventsForDay(day.date, 'wow').map((e) => (
                        <div
                          key={e.id}
                          className="flex items-center gap-1 rounded bg-white border border-slate-200 px-1 py-0.5"
                          title={e.title}
                        >
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: e.color || '#22c55e' }}
                          />
                          <span className="truncate text-[9px] font-medium text-slate-700">
                            {e.title}
                            {e.store === 'all' ? ' (공통)' : ''}
                          </span>
                        </div>
                      ))}
                      {/* 주간 메모(EVENT) — 편집 가능 */}
                      {isEditingNotes ? (
                        <textarea
                          value={weekNotes[day.date]?.eventWow || ''}
                          onChange={(e) => handleNoteChange(day.date, 'eventWow', e.target.value)}
                          className="w-full p-1 text-[10px] border border-slate-200 rounded bg-white focus:ring-1 focus:ring-emerald-500 focus:border-transparent outline-none transition-all resize-none"
                          placeholder="이벤트..."
                          rows={1}
                        />
                      ) : weekNotes[day.date]?.eventWow ? (
                        <div className="p-1 text-[10px] text-slate-600 bg-slate-50/50 rounded">
                          {weekNotes[day.date]?.eventWow}
                        </div>
                      ) : null}
                    </div>
                  </td>
                ))}
              </tr>

              {/* WOW Staff Schedule Row */}
              {weekDates.map((day, idx) => {
                if (idx !== 0) return null;
                return (
                  <tr key={`wow-${day.date}`}>
                    <td className="p-1.5 text-center bg-white border-r border-slate-200 sticky left-0 z-10">
                      <div className="flex flex-col items-center justify-center h-full">
                        <span className="font-bold text-slate-700 text-[10px]">STAFF</span>
                      </div>
                    </td>
                    {weekDates.map((d) => {
                      const schedules = d.schedules.filter(s => s.store === 'accent-wow');
                      return (
                        <td key={d.date} className="p-1 border-r border-slate-100 last:border-r-0 align-top h-[100px]">
                          <div className="flex flex-col gap-1 h-full">
                            {isEditingNotes && (
                              <div className="mb-1">
                                <select
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleAddSchedule(d.date, e.target.value, '11:40', '19:00', undefined, 'accent-wow');
                                      e.target.value = '';
                                    }
                                  }}
                                  className="w-full text-[10px] py-1.5 px-1 border-2 border-dashed border-emerald-400 rounded bg-emerald-50 text-emerald-700 font-bold hover:bg-emerald-100 hover:border-emerald-500 transition-colors cursor-pointer outline-none appearance-none text-center"
                                  style={{ backgroundImage: 'none' }}
                                >
                                  <option value="">+ 추가</option>
                                  {employees
                                    .filter(emp => !schedules.find(s => s.employeeId === emp.id))
                                    .map(emp => (
                                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                                    ))}
                                </select>
                              </div>
                            )}
                            {schedules.map((schedule) => {
                              const isEditing = editingCell?.date === d.date && editingCell?.employeeId === schedule.employeeId;

                              if (isEditing) {
                                return (
                                  <ScheduleEditCell
                                    key={schedule.employeeId}
                                    employeeName={schedule.employeeName}
                                    employeeId={schedule.employeeId}
                                    schedule={schedule}
                                    onSave={(start, end, notes) => handleAddSchedule(d.date, schedule.employeeId, start, end, notes, 'accent-wow')}
                                    onCancel={() => setEditingCell(null)}
                                    onDelete={() => handleDeleteSchedule(d.date, schedule.employeeId, 'accent-wow')}
                                    defaultStartTime="11:40"
                                    defaultEndTime="19:00"
                                  />
                                );
                              }

                              return (
                                <div
                                  key={schedule.employeeId}
                                  onClick={() => isEditingNotes && setEditingCell({ date: d.date, employeeId: schedule.employeeId })}
                                  className={`group relative p-1.5 bg-white border-l-2 border-emerald-400 rounded-r shadow-sm transition-all ring-1 ring-slate-100 ${isEditingNotes ? 'hover:shadow cursor-pointer' : ''}`}
                                >
                                  <div className="flex justify-between items-start">
                                    <span className="font-bold text-[11px] text-slate-800">{schedule.employeeName}</span>
                                  </div>
                                  <div className="text-[9px] font-medium text-emerald-600 bg-emerald-50 inline-block px-1 py-0.5 rounded mt-0.5">
                                    {schedule.startTime}-{schedule.endTime}
                                  </div>
                                  {schedule.notes && (
                                    <div className="text-[9px] text-slate-500 leading-tight truncate mt-0.5">
                                      {schedule.notes}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* WOW Note Row */}
              <tr className="group hover:bg-slate-50/50 transition-colors">
                <td className="p-1.5 text-[10px] font-bold text-slate-500 text-center bg-slate-50 border-r border-slate-200 sticky left-0 z-10">비고</td>
                {weekDates.map((day) => (
                  <td key={day.date} className="p-1 border-r border-slate-100 last:border-r-0 align-top">
                    {isEditingNotes ? (
                      <textarea
                        value={weekNotes[day.date]?.noteWow || ''}
                        onChange={(e) => handleNoteChange(day.date, 'noteWow', e.target.value)}
                        className="w-full p-1 text-[10px] border border-slate-200 rounded bg-white focus:ring-1 focus:ring-emerald-500 focus:border-transparent outline-none transition-all resize-none"
                        placeholder="비고..."
                        rows={1}
                      />
                    ) : (
                      <div className="min-h-[16px] p-1 text-[10px] text-slate-500 italic bg-slate-50/30 rounded">
                        {weekNotes[day.date]?.noteWow}
                      </div>
                    )}
                  </td>
                ))}
              </tr>

            </tbody>
          </table>
        </div>

        <div className="bg-slate-50 p-2 border-t border-slate-200">
          <p className="text-[10px] text-slate-400 text-center">
            * 스케줄 변경 시 반드시 [저장] 버튼을 눌러주세요.
          </p>
        </div>
      </div>
    </div>
  );
}

interface ScheduleEditCellProps {
  employeeName: string;
  employeeId: string;
  schedule?: { startTime: string; endTime: string; notes?: string };
  onSave: (startTime: string, endTime: string, notes?: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  defaultStartTime: string;
  defaultEndTime: string;
}

function ScheduleEditCell({
  employeeName,
  schedule,
  onSave,
  onCancel,
  onDelete,
  defaultStartTime,
  defaultEndTime
}: ScheduleEditCellProps) {
  const [startTime, setStartTime] = useState(schedule?.startTime || defaultStartTime);
  const [endTime, setEndTime] = useState(schedule?.endTime || defaultEndTime);
  const [notes, setNotes] = useState(schedule?.notes || '');

  return (
    <div className="relative p-3 bg-white border border-indigo-500 rounded-lg shadow-xl z-20 animate-in fade-in zoom-in-95 duration-200">
      <div className="flex justify-between items-center mb-2">
        <div className="font-bold text-sm text-slate-800">{employeeName}</div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="flex-1 text-xs p-1.5 border border-slate-200 rounded bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none"
            autoFocus
          />
          <span className="text-slate-400">-</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="flex-1 text-xs p-1.5 border border-slate-200 rounded bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none"
          />
        </div>

        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="메모 작성..."
          className="w-full text-xs p-1.5 border border-slate-200 rounded bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none"
        />

        <div className="flex gap-1.5 pt-1">
          <button
            onClick={() => onSave(startTime, endTime, notes)}
            className="flex-1 bg-indigo-600 text-white text-xs py-1.5 rounded hover:bg-indigo-700 transition font-medium"
          >
            확인
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-white border border-slate-300 text-slate-600 text-xs py-1.5 rounded hover:bg-slate-50 transition"
          >
            취소
          </button>
          <button
            onClick={onDelete}
            className="px-2 bg-rose-100 text-rose-600 border border-rose-200 text-xs py-1.5 rounded hover:bg-rose-200 transition"
            title="삭제"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
}
