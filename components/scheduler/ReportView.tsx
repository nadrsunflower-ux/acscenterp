'use client';

import { useState, useEffect } from 'react';
import { Employee, WorkSchedule } from '@/lib/scheduler/types';
import { storage } from '@/lib/scheduler/storage';
import { STORES } from '@/lib/scheduler/types';
import { formatCurrency, groupSchedulesByWeek, calculateWeeklyHolidayPay, calculateFreelancerTax } from '@/lib/scheduler/calculations';

interface EmployeeReport {
  employee: Employee;
  schedules: WorkSchedule[];
  totalHours: number;
  totalPay: number;
  weeklyHolidayPay: number;
  totalWithHolidayPay: number;
  freelancerTax: number;
  totalAfterTax: number;
  workDays: { [date: string]: { hours: number; dayOfWeek: string } };
}

export default function ReportView() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedStore, setSelectedStore] = useState<'all' | 'accent-id' | 'accent-wow'>('all');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);

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

    // 사용 가능한 월 목록 생성 (실제 스케줄이 있는 월만)
    const months = new Set<string>();
    schedulesData.forEach(schedule => {
      const month = schedule.date.substring(0, 7); // YYYY-MM
      months.add(month);
    });

    const sortedMonths = Array.from(months).sort().reverse();
    setAvailableMonths(sortedMonths);

    if (sortedMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(sortedMonths[0]);
    }
  };

  const filteredSchedules = schedules.filter(schedule => {
    if (selectedStore !== 'all' && schedule.store !== selectedStore) return false;
    if (selectedMonth && !schedule.date.startsWith(selectedMonth)) return false;
    return true;
  });

  // 아르바이트생 통계 (실제 급여 지급 대상)
  const employeeReports: EmployeeReport[] = employees
    .filter(emp => !emp.isStaff) // 아르바이트생만
    .map(employee => {
      const employeeSchedules = filteredSchedules.filter(s => s.employeeId === employee.id);
      const totalHours = employeeSchedules.reduce((sum, s) => sum + s.hours, 0);
      const totalPay = employeeSchedules.reduce((sum, s) => sum + s.pay, 0);

      // 주휴수당 계산: 월 경계와 관계없이 실제 주 단위로 계산
      // 해당 직원의 전체 스케줄에서 주별로 그룹화
      const allEmployeeSchedules = schedules.filter(s =>
        s.employeeId === employee.id &&
        (selectedStore === 'all' || s.store === selectedStore)
      );
      const weeks = groupSchedulesByWeek(allEmployeeSchedules);
      let weeklyHolidayPay = 0;

      // 김제연은 주휴수당이 시급에 포함되어 있음
      if (!employee.includesHolidayPay) {
        weeks.forEach((weekSchedules) => {
          // 주의 마지막 근무일이 선택된 월에 속하는지 확인 (중복 방지)
          const sortedDates = weekSchedules.map(s => s.date).sort();
          const lastWorkDate = sortedDates[sortedDates.length - 1];

          if (lastWorkDate && lastWorkDate.startsWith(selectedMonth)) {
            // 주 전체 시간으로 주휴수당 계산 (월 경계 무시)
            const weekHours = weekSchedules.reduce((sum, s) => sum + s.hours, 0);
            weeklyHolidayPay += calculateWeeklyHolidayPay(weekHours, employee.hourlyWage);
          }
        });
      }

      // 근무 요일별 정리
      const workDays: { [date: string]: { hours: number; dayOfWeek: string } } = {};
      employeeSchedules.forEach(schedule => {
        const date = new Date(schedule.date);
        const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
        workDays[schedule.date] = {
          hours: schedule.hours,
          dayOfWeek,
        };
      });

      const totalWithHolidayPay = totalPay + weeklyHolidayPay;
      const freelancerTax = calculateFreelancerTax(totalWithHolidayPay);
      const totalAfterTax = totalWithHolidayPay - freelancerTax;

      return {
        employee,
        schedules: employeeSchedules,
        totalHours,
        totalPay,
        weeklyHolidayPay,
        totalWithHolidayPay,
        freelancerTax,
        totalAfterTax,
        workDays,
      };
    })
    .filter(report => report.schedules.length > 0)
    .sort((a, b) => b.totalAfterTax - a.totalAfterTax);

  // 정규직 업무량 분석 (참고용)
  const staffReports: EmployeeReport[] = employees
    .filter(emp => emp.isStaff) // 정규직만
    .map(employee => {
      const employeeSchedules = filteredSchedules.filter(s => s.employeeId === employee.id);
      const totalHours = employeeSchedules.reduce((sum, s) => sum + s.hours, 0);
      const totalPay = employeeSchedules.reduce((sum, s) => sum + s.pay, 0);

      // 주휴수당 계산: 월 경계와 관계없이 실제 주 단위로 계산
      const allEmployeeSchedules = schedules.filter(s =>
        s.employeeId === employee.id &&
        (selectedStore === 'all' || s.store === selectedStore)
      );
      const weeks = groupSchedulesByWeek(allEmployeeSchedules);
      let weeklyHolidayPay = 0;

      if (!employee.includesHolidayPay) {
        weeks.forEach((weekSchedules) => {
          // 주의 마지막 근무일이 선택된 월에 속하는지 확인 (중복 방지)
          const sortedDates = weekSchedules.map(s => s.date).sort();
          const lastWorkDate = sortedDates[sortedDates.length - 1];

          if (lastWorkDate && lastWorkDate.startsWith(selectedMonth)) {
            // 주 전체 시간으로 주휴수당 계산 (월 경계 무시)
            const weekHours = weekSchedules.reduce((sum, s) => sum + s.hours, 0);
            weeklyHolidayPay += calculateWeeklyHolidayPay(weekHours, employee.hourlyWage);
          }
        });
      }

      // 근무 요일별 정리
      const workDays: { [date: string]: { hours: number; dayOfWeek: string } } = {};
      employeeSchedules.forEach(schedule => {
        const date = new Date(schedule.date);
        const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
        workDays[schedule.date] = {
          hours: schedule.hours,
          dayOfWeek,
        };
      });

      const totalWithHolidayPay = totalPay + weeklyHolidayPay;
      const freelancerTax = calculateFreelancerTax(totalWithHolidayPay);
      const totalAfterTax = totalWithHolidayPay - freelancerTax;

      return {
        employee,
        schedules: employeeSchedules,
        totalHours,
        totalPay,
        weeklyHolidayPay,
        totalWithHolidayPay,
        freelancerTax,
        totalAfterTax,
        workDays,
      };
    })
    .filter(report => report.schedules.length > 0)
    .sort((a, b) => b.totalHours - a.totalHours);

  const totalPay = employeeReports.reduce((sum, report) => sum + report.totalPay, 0);
  const totalHolidayPay = employeeReports.reduce((sum, report) => sum + report.weeklyHolidayPay, 0);
  const totalWithHolidayPay = totalPay + totalHolidayPay;
  const totalTax = employeeReports.reduce((sum, report) => sum + report.freelancerTax, 0);
  const totalAfterTax = totalWithHolidayPay - totalTax;
  const totalHours = employeeReports.reduce((sum, report) => sum + report.totalHours, 0);

  const storeStats = STORES.map(store => {
    const storeSchedules = filteredSchedules.filter(s => s.store === store.id);
    const storePay = storeSchedules.reduce((sum, s) => sum + s.pay, 0);
    const storeHours = storeSchedules.reduce((sum, s) => sum + s.hours, 0);

    // 매장별 주휴수당 계산: 해당 매장에서 근무한 직원들 기준
    // 해당 매장에서 근무한 직원 ID 목록 추출
    const employeeIdsInStore = [...new Set(storeSchedules.map(s => s.employeeId))];
    const storeEmployees = employees.filter(e => employeeIdsInStore.includes(e.id) && !e.isStaff);
    let storeHolidayPay = 0;

    storeEmployees.forEach(emp => {
      // 해당 직원의 해당 매장 전체 스케줄에서 주별로 그룹화
      const allEmpStoreSchedules = schedules.filter(s =>
        s.employeeId === emp.id && s.store === store.id
      );
      const weeks = groupSchedulesByWeek(allEmpStoreSchedules);

      // 김제연은 주휴수당이 시급에 포함되어 있음
      if (!emp.includesHolidayPay) {
        weeks.forEach((weekSchedules) => {
          // 주의 마지막 근무일이 선택된 월에 속하는지 확인 (중복 방지)
          const sortedDates = weekSchedules.map(s => s.date).sort();
          const lastWorkDate = sortedDates[sortedDates.length - 1];

          if (lastWorkDate && lastWorkDate.startsWith(selectedMonth)) {
            // 주 전체 시간으로 주휴수당 계산 (월 경계 무시)
            const weekHours = weekSchedules.reduce((sum, s) => sum + s.hours, 0);
            storeHolidayPay += calculateWeeklyHolidayPay(weekHours, emp.hourlyWage);
          }
        });
      }
    });

    const storeTotalPay = storePay + storeHolidayPay;
    const storeTax = calculateFreelancerTax(storeTotalPay);
    const storeAfterTax = storeTotalPay - storeTax;

    return {
      store,
      pay: storePay,
      holidayPay: storeHolidayPay,
      totalPay: storeTotalPay,
      tax: storeTax,
      afterTax: storeAfterTax,
      hours: storeHours,
      count: storeSchedules.length,
    };
  });

  const formatMonthDisplay = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    return `${year}년 ${parseInt(month)}월`;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">근무 통계</h2>
          <p className="text-sm text-slate-500 mt-1">월별 급여 및 매장 현황 분석</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value as 'all' | 'accent-id' | 'accent-wow')}
              className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="all">전체 매장</option>
              {STORES.map(store => (
                <option key={store.id} value={store.id}>{store.name.replace('ACCENT', "AC'")}</option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {availableMonths.map(month => (
                <option key={month} value={month}>{formatMonthDisplay(month)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="p-6 bg-slate-50/50">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="text-4xl">💰</span>
            </div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">기본 급여</div>
            <div className="text-xl font-bold text-slate-800">{formatCurrency(totalPay)}원</div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="text-4xl text-emerald-500">🎁</span>
            </div>
            <div className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-1">주휴수당</div>
            <div className="text-xl font-bold text-emerald-700">{formatCurrency(totalHolidayPay)}원</div>
          </div>

          <div className="bg-white p-4 rounded-xl border-2 border-indigo-100 shadow-sm relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="text-4xl text-indigo-500">💎</span>
            </div>
            <div className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-1">실수령액 (직원)</div>
            <div className="text-xl font-extrabold text-indigo-700">{formatCurrency(totalWithHolidayPay)}원</div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="text-4xl text-rose-500">📉</span>
            </div>
            <div className="text-xs font-bold text-rose-600 uppercase tracking-wide mb-1">세금 (3.3%)</div>
            <div className="text-xl font-bold text-rose-700">+{formatCurrency(totalTax)}원</div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="text-4xl text-amber-500">🏢</span>
            </div>
            <div className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-1">총 지출 (회사)</div>
            <div className="text-xl font-bold text-amber-700">{formatCurrency(totalWithHolidayPay + totalTax)}원</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Store Stats */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 lg:col-span-1">
            <h3 className="font-bold text-lg text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-indigo-500 rounded-full"></span>
              매장별 현황
            </h3>
            <div className="space-y-4">
              {storeStats.map(stat => (
                <div key={stat.store.id} className="p-4 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-bold text-slate-800">{stat.store.name.replace('ACCENT', "AC'SCENT")}</h4>
                    <span className="text-xs font-medium px-2 py-1 bg-white rounded border border-slate-200 text-slate-500">
                      {stat.hours.toFixed(1)}시간
                    </span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">기본급 + 주휴</span>
                      <span className="font-medium">{formatCurrency(stat.totalPay)}원</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">세금 (3.3%)</span>
                      <span className="font-medium text-rose-500">+{formatCurrency(stat.tax)}원</span>
                    </div>
                    <div className="pt-2 mt-1 border-t border-slate-200 flex justify-between items-center">
                      <span className="font-bold text-slate-700">총 지출액</span>
                      <span className="font-bold text-indigo-600 text-lg">{formatCurrency(stat.totalPay + stat.tax)}원</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payroll List */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 overflow-hidden lg:col-span-2">
            <h3 className="font-bold text-lg text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-emerald-500 rounded-full"></span>
              직원별 급여 명세
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left table-fixed">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-100">
                    <th className="py-2 px-3 font-semibold rounded-tl-lg w-[25%]">이름</th>
                    <th className="py-2 px-3 font-semibold text-center w-[18%]">기본급</th>
                    <th className="py-2 px-3 font-semibold text-center w-[18%]">주휴수당</th>
                    <th className="py-2 px-3 font-semibold text-center w-[20%]">실수령액</th>
                    <th className="py-2 px-3 font-semibold text-center rounded-tr-lg w-[19%]">세금포함</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {employeeReports.map(report => {
                    // 실제 근무한 매장들 표시
                    const workedStores = [...new Set(report.schedules.map(s => s.store))];
                    return (
                    <tr key={report.employee.id} className="group hover:bg-slate-50/50">
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-800">{report.employee.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {workedStores.map(storeId => STORES.find(s => s.id === storeId)?.name.replace('ACCENT', "AC'")).join(', ')}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="font-medium text-slate-700">{formatCurrency(report.totalPay)}원</div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {report.weeklyHolidayPay > 0 ? (
                          <div className="font-medium text-emerald-600">+{formatCurrency(report.weeklyHolidayPay)}원</div>
                        ) : (
                          <div className="text-slate-300">-</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="font-bold text-indigo-600">{formatCurrency(report.totalWithHolidayPay)}원</div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="font-medium text-amber-700">{formatCurrency(report.totalWithHolidayPay + report.freelancerTax)}원</div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Staff Analysis */}
        <div className="bg-slate-100/50 rounded-xl border border-dashed border-slate-300 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-700">정규직 업무량 (참고용)</h3>
            <span className="text-xs text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">최저시급 10,320원 기준</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {staffReports.map(report => {
              // 최저시급 기준 계산
              const MINIMUM_WAGE = 10320;
              const basePay = Math.round(report.totalHours * MINIMUM_WAGE);
              const holidayPay = report.weeklyHolidayPay;
              const totalPay = basePay + holidayPay;

              return (
                <div key={report.employee.id} className="bg-white p-4 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="font-bold text-slate-800">{report.employee.name}</span>
                      <div className="text-xs text-slate-500 mt-0.5">{report.schedules.length}일 근무</div>
                    </div>
                    <span className="font-bold text-indigo-600 text-lg">{report.totalHours.toFixed(1)}H</span>
                  </div>
                  <div className="space-y-1.5 text-sm border-t border-slate-100 pt-3">
                    <div className="flex justify-between">
                      <span className="text-slate-500">기본급</span>
                      <span className="font-medium text-slate-700">{formatCurrency(basePay)}원</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-emerald-600">주휴수당</span>
                      <span className="font-medium text-emerald-600">+{formatCurrency(holidayPay)}원</span>
                    </div>
                    <div className="flex justify-between pt-1.5 border-t border-slate-100">
                      <span className="font-bold text-slate-700">환산 비용</span>
                      <span className="font-bold text-indigo-600">{formatCurrency(totalPay)}원</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
