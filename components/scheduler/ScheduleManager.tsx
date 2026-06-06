'use client';

import { useState, useEffect } from 'react';
import { Employee, WorkSchedule } from '@/lib/scheduler/types';
import { storage } from '@/lib/scheduler/storage';
import { STORES } from '@/lib/scheduler/types';
import { calculateHours, calculatePay, formatDateDisplay, formatCurrency, groupSchedulesByWeek, calculateWeeklyHolidayPay } from '@/lib/scheduler/calculations';

export default function ScheduleManager() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<'all' | 'accent-id' | 'accent-wow'>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    employeeId: '',
    date: '',
    startTime: '12:30',
    endTime: '19:30',
    store: 'accent-id' as 'accent-id' | 'accent-wow',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [employeesData, schedulesData] = await Promise.all([
      storage.getEmployees(),
      storage.getSchedules()
    ]);

    setEmployees(employeesData);
    setSchedules(schedulesData);

    // 사용 가능한 월 목록 생성
    const months = new Set<string>();
    schedulesData.forEach(schedule => {
      const month = schedule.date.substring(0, 7); // YYYY-MM
      months.add(month);
    });

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    months.add(currentMonth);

    const sortedMonths = Array.from(months).sort().reverse();
    setAvailableMonths(sortedMonths);

    if (sortedMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(sortedMonths[0]);
    }
  };

  const handleEmployeeChange = (employeeId: string) => {
    const employee = employees.find(e => e.id === employeeId);
    if (employee) {
      const storeId = employee.store || 'accent-id';
      const store = STORES.find(s => s.id === storeId);
      setFormData({
        ...formData,
        employeeId,
        store: storeId,
        startTime: store?.defaultStartTime || '12:30',
        endTime: store?.defaultEndTime || '19:30',
      });
    } else {
      setFormData({ ...formData, employeeId });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const employee = employees.find(e => e.id === formData.employeeId);
    if (!employee) return;

    const hours = calculateHours(formData.startTime, formData.endTime);
    const pay = calculatePay(hours, employee.hourlyWage);

    if (editingId) {
      const updatedSchedule: WorkSchedule = {
        id: editingId,
        ...formData,
        hours,
        pay,
      };
      await storage.updateSchedule(editingId, updatedSchedule);
      setEditingId(null);
    } else {
      const newSchedule: WorkSchedule = {
        id: Date.now().toString(),
        ...formData,
        hours,
        pay,
      };
      await storage.addSchedule(newSchedule);
    }

    const schedulesData = await storage.getSchedules();
    setSchedules(schedulesData);
    setFormData({
      employeeId: '',
      date: '',
      startTime: '12:30',
      endTime: '19:30',
      store: 'accent-id',
    });
    setIsAdding(false);
  };

  const handleEdit = (schedule: WorkSchedule) => {
    setFormData({
      employeeId: schedule.employeeId,
      date: schedule.date,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      store: schedule.store,
    });
    setEditingId(schedule.id);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('정말 삭제하시겠습니까?')) {
      await storage.deleteSchedule(id);
      const schedulesData = await storage.getSchedules();
      setSchedules(schedulesData);
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({
      employeeId: '',
      date: '',
      startTime: '12:30',
      endTime: '19:30',
      store: 'accent-id',
    });
  };

  const filteredSchedules = schedules
    .filter(schedule => {
      if (selectedStore !== 'all' && schedule.store !== selectedStore) return false;
      if (selectedMonth && !schedule.date.startsWith(selectedMonth)) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  // 직원별로 그룹화
  const employeeGroups = employees
    .filter(emp => !emp.isStaff) // 알바만 표시
    .map(employee => {
      const employeeSchedules = filteredSchedules
        .filter(s => s.employeeId === employee.id)
        .sort((a, b) => b.date.localeCompare(a.date));

      const totalHours = employeeSchedules.reduce((sum, s) => sum + s.hours, 0);
      const totalPay = employeeSchedules.reduce((sum, s) => sum + s.pay, 0);

      // 주휴수당 계산: 월 경계와 관계없이 실제 주 단위로 계산
      const allEmployeeSchedules = schedules.filter(s =>
        s.employeeId === employee.id &&
        (selectedStore === 'all' || s.store === selectedStore)
      );
      const weeks = groupSchedulesByWeek(allEmployeeSchedules);
      let weeklyHolidayPay = 0;
      const holidayPayDetails: { weekStart: string; weekEnd: string; hours: number; pay: number }[] = [];

      if (!employee.includesHolidayPay) {
        weeks.forEach((weekSchedules) => {
          // 주의 마지막 근무일이 선택된 월에 속하는지 확인 (중복 방지)
          const sortedDates = weekSchedules.map(s => s.date).sort();
          const firstWorkDate = sortedDates[0];
          const lastWorkDate = sortedDates[sortedDates.length - 1];

          if (lastWorkDate && lastWorkDate.startsWith(selectedMonth)) {
            // 주 전체 시간으로 주휴수당 계산 (월 경계 무시)
            const weekHours = weekSchedules.reduce((sum, s) => sum + s.hours, 0);
            const pay = calculateWeeklyHolidayPay(weekHours, employee.hourlyWage);
            if (pay > 0) {
              weeklyHolidayPay += pay;
              holidayPayDetails.push({
                weekStart: firstWorkDate,
                weekEnd: lastWorkDate,
                hours: weekHours,
                pay,
              });
            }
          }
        });
      }

      return {
        employee,
        schedules: employeeSchedules,
        totalHours,
        totalPay,
        weeklyHolidayPay,
        holidayPayDetails,
        totalWithHolidayPay: totalPay + weeklyHolidayPay,
      };
    })
    .filter(group => group.schedules.length > 0)
    .sort((a, b) => b.totalWithHolidayPay - a.totalWithHolidayPay);

  const totalPay = employeeGroups.reduce((sum, group) => sum + group.totalWithHolidayPay, 0);

  const formatMonthDisplay = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    return `${year}년 ${parseInt(month)}월`;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">근무 리포트</h2>
          <p className="text-sm text-slate-500 mt-1">월별, 매장별 근무 기록 및 급여 확인</p>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-md hover:shadow-lg"
          >
            <span>+</span> 근무 추가
          </button>
        )}
      </div>

      <div className="p-6">
        {isAdding && (
          <div className="mb-8 p-6 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300">
            <h3 className="font-bold text-slate-800 text-lg mb-4">
              {editingId ? '근무 기록 수정' : '새 근무 기록 추가'}
            </h3>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">직원</label>
                  <select
                    value={formData.employeeId}
                    onChange={(e) => handleEmployeeChange(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white text-sm"
                    required
                  >
                    <option value="">직원 선택</option>
                    {employees.map(employee => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} ({STORES.find(s => s.id === employee.store)?.name.replace('ACCENT', "AC'")})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">날짜</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">출근 시간</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">퇴근 시간</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">매장</label>
                  <select
                    value={formData.store}
                    onChange={(e) => setFormData({ ...formData, store: e.target.value as 'accent-id' | 'accent-wow' })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white text-sm"
                  >
                    {STORES.map(store => (
                      <option key={store.id} value={store.id}>{store.name.replace('ACCENT', "AC'SCENT")}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-md transition-colors"
                >
                  {editingId ? '수정 완료' : '등록하기'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Filters and Stats */}
        <div className="flex flex-col md:flex-row justify-between items-end gap-4 mb-6">
          <div className="flex gap-4 w-full md:w-auto">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">매장 필터</label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value as 'all' | 'accent-id' | 'accent-wow')}
                className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-w-[120px]"
              >
                <option value="all">전체</option>
                {STORES.map(store => (
                  <option key={store.id} value={store.id}>{store.name.replace('ACCENT', "AC'SCENT")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">월 선택</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-w-[120px]"
              >
                {availableMonths.map(month => (
                  <option key={month} value={month}>{formatMonthDisplay(month)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-indigo-50 px-4 py-3 rounded-xl border border-indigo-100 flex items-center gap-3 w-full md:w-auto">
            <span className="text-sm font-medium text-indigo-900">당월 총 급여 예상</span>
            <span className="text-xl font-bold text-indigo-700">{formatCurrency(totalPay)}원</span>
          </div>
        </div>

        {/* List */}
        <div className="space-y-4">
          {employeeGroups.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <p className="text-slate-500">등록된 근무 기록이 없습니다.</p>
            </div>
          ) : (
            employeeGroups.map(group => (
              <details key={group.employee.id} className="group border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm open:shadow-md transition-all">
                <summary className="cursor-pointer p-4 bg-white hover:bg-slate-50 transition-colors list-none [&::-webkit-details-marker]:hidden flex justify-between items-center select-none">
                  <div className="flex items-center gap-4">
                    <span className="font-bold text-lg text-slate-800 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                      {group.employee.name}
                    </span>
                    {group.employee.includesHolidayPay && (
                      <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 border border-purple-100 rounded-md">주휴포함</span>
                    )}
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right hidden sm:block">
                      <div className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">근무일수</div>
                      <div className="font-semibold text-slate-700">{group.schedules.length}일</div>
                    </div>
                    <div className="text-right hidden sm:block">
                      <div className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">총 시간</div>
                      <div className="font-semibold text-slate-700">{group.totalHours.toFixed(1)}H</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">예상 급여</div>
                      <div className="font-bold text-indigo-600">{formatCurrency(group.totalWithHolidayPay)}원</div>
                      {group.weeklyHolidayPay > 0 && (
                        <div className="text-[10px] text-emerald-600">+주휴 {formatCurrency(group.weeklyHolidayPay)}</div>
                      )}
                    </div>
                    <div className="text-slate-400 transform transition-transform group-open:rotate-180">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </div>
                  </div>
                </summary>

                <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-400 uppercase tracking-wider text-left border-b border-slate-200">
                        <th className="py-2 px-3 font-semibold">날짜</th>
                        <th className="py-2 px-3 font-semibold hidden sm:table-cell">매장</th>
                        <th className="py-2 px-3 font-semibold">시간</th>
                        <th className="py-2 px-3 font-semibold hidden sm:table-cell">시수</th>
                        <th className="py-2 px-3 font-semibold">급여</th>
                        <th className="py-2 px-3 font-semibold text-right">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.schedules.map(schedule => (
                        <tr key={schedule.id} className="hover:bg-white transition-colors">
                          <td className="py-3 px-3 font-medium text-slate-700">{formatDateDisplay(schedule.date)}</td>
                          <td className="py-3 px-3 text-slate-500 hidden sm:table-cell">{STORES.find(s => s.id === schedule.store)?.name.replace('ACCENT', "AC'")}</td>
                          <td className="py-3 px-3 text-slate-600 font-mono">{schedule.startTime} - {schedule.endTime}</td>
                          <td className="py-3 px-3 text-slate-600 hidden sm:table-cell">{schedule.hours}H</td>
                          <td className="py-3 px-3 font-medium text-slate-700">{formatCurrency(schedule.pay)}원</td>
                          <td className="py-3 px-3 text-right space-x-2">
                            <button
                              onClick={() => handleEdit(schedule)}
                              className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors"
                            >
                              수정
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              onClick={() => handleDelete(schedule.id)}
                              className="text-xs font-medium text-slate-500 hover:text-rose-600 transition-colors"
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* 주휴수당 상세 */}
                  {group.holidayPayDetails.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">주휴수당 내역</div>
                      <div className="space-y-1">
                        {group.holidayPayDetails.map((detail, idx) => {
                          const startDate = new Date(detail.weekStart);
                          const endDate = new Date(detail.weekEnd);
                          const formatShort = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
                          return (
                            <div key={idx} className="flex justify-between items-center text-sm bg-emerald-50 px-3 py-2 rounded-lg">
                              <span className="text-slate-600">
                                {formatShort(startDate)} ~ {formatShort(endDate)} 주 ({detail.hours.toFixed(1)}H)
                              </span>
                              <span className="font-semibold text-emerald-700">+{formatCurrency(detail.pay)}원</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
