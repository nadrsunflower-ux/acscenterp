'use client';

import { useState, useEffect, Fragment } from 'react';
import { Employee } from '@/lib/scheduler/types';
import { storage } from '@/lib/scheduler/storage';
import { initialEmployees } from '@/lib/scheduler/employees';

export default function EmployeeManager() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    hourlyWage: 10030,
    isStaff: false, // 임직원(고정 월급) 여부 — true면 시급 미계산, 근무시간만 집계
    includesHolidayPay: false, // 알바 중 주휴수당이 시급에 포함되어 별도 가산 안 함
  });

  // 구분: 임직원(고정 월급) / 알바(시급) 2종만 사용.
  // includesHolidayPay 필드는 UI에서 제거(주휴 포함/비포함 구분 미사용)하되,
  // 기존 데이터 값은 edit/save 시 그대로 보존한다(급여 임의 변경 방지).
  type EmployeeKind = 'salary' | 'hourly';
  const formKind: EmployeeKind = formData.isStaff ? 'salary' : 'hourly';

  const handleKindChange = (kind: EmployeeKind) => {
    if (kind === 'salary') {
      // 임직원(고정 월급): 시급 계산 안 함 → 시급 0
      setFormData({ ...formData, isStaff: true, hourlyWage: 0 });
    } else {
      setFormData({ ...formData, isStaff: false, hourlyWage: formData.hourlyWage || 10030 });
    }
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    const data = await storage.getEmployees();
    setEmployees(data);
  };

  const handleResetEmployees = async () => {
    if (confirm('기본 직원 데이터로 초기화하시겠습니까? 기존 데이터는 모두 삭제됩니다.')) {
      await storage.saveEmployees(initialEmployees);
      setEmployees(initialEmployees);
      alert('직원 데이터가 초기화되었습니다.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingId) {
      const updatedEmployee: Employee = {
        id: editingId,
        ...formData,
      };
      await storage.updateEmployee(editingId, updatedEmployee);
      setEditingId(null);
    } else {
      const newEmployee: Employee = {
        id: Date.now().toString(),
        ...formData,
      };
      await storage.addEmployee(newEmployee);
    }

    const data = await storage.getEmployees();
    setEmployees(data);
    setFormData({ name: '', hourlyWage: 10030, isStaff: false, includesHolidayPay: false });
    setIsAdding(false);
  };

  const handleEdit = (employee: Employee) => {
    setFormData({
      name: employee.name,
      hourlyWage: employee.hourlyWage,
      isStaff: employee.isStaff || false,
      includesHolidayPay: employee.includesHolidayPay || false,
    });
    setEditingId(employee.id);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('정말 삭제하시겠습니까?')) {
      await storage.deleteEmployee(id);
      const data = await storage.getEmployees();
      setEmployees(data);
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', hourlyWage: 10030, isStaff: false, includesHolidayPay: false });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">직원 관리</h2>
          <p className="text-sm text-slate-500 mt-1">매장별 직원 목록 및 정보 관리</p>
        </div>

        <div className="flex gap-2">
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-md hover:shadow-lg"
            >
              <span>+</span> 직원 추가
            </button>
          )}
        </div>
      </div>

      <div className="p-6">
        {isAdding && (
          <div className="mb-8 p-6 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-800 text-lg">
                {editingId ? '직원 정보 수정' : '새 직원 등록'}
              </h3>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">이름</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white transition-all text-sm"
                    placeholder="이름 입력"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">구분</label>
                  <select
                    value={formKind}
                    onChange={(e) => handleKindChange(e.target.value as EmployeeKind)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white transition-all text-sm"
                  >
                    <option value="salary">임직원 (고정 월급)</option>
                    <option value="hourly">알바 (시급)</option>
                  </select>
                </div>
                {/* 임직원(고정 월급)은 시급을 계산하지 않으므로 시급 입력 숨김 */}
                {!formData.isStaff ? (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">시급</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 text-sm">₩</span>
                      <input
                        type="number"
                        value={formData.hourlyWage}
                        onChange={(e) => setFormData({ ...formData, hourlyWage: Number(e.target.value) })}
                        className="w-full pl-8 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white transition-all text-sm font-mono"
                        required
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">시급</label>
                    <div className="px-3 py-2.5 rounded-lg bg-slate-100 text-sm text-slate-400 border border-slate-200">
                      고정 월급 — 시급 미적용
                    </div>
                  </div>
                )}
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

        <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-bold tracking-wider">
                <th className="py-4 px-6">이름</th>
                <th className="py-4 px-6">시급</th>
                <th className="py-4 px-6 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-slate-400">
                    <p className="text-base font-medium">등록된 직원이 없습니다.</p>
                    <p className="text-sm mt-1">상단의 '직원 추가' 버튼을 눌러 직원을 등록해주세요.</p>
                  </td>
                </tr>
              ) : (
                // 임직원 / 알바 그룹으로 구분해서 표시
                ([
                  { key: 'staff', label: '임직원', list: employees.filter((e) => e.isStaff) },
                  { key: 'alba', label: '알바', list: employees.filter((e) => !e.isStaff) },
                ] as const).map((groupItem) =>
                  groupItem.list.length === 0 ? null : (
                    <Fragment key={groupItem.key}>
                      <tr className="bg-slate-50">
                        <td
                          colSpan={3}
                          className="py-2.5 px-6 text-xs font-bold uppercase tracking-wider text-slate-500 border-y border-slate-200"
                        >
                          {groupItem.label}
                          <span className="ml-1.5 font-medium normal-case text-slate-400">
                            {groupItem.list.length}명
                          </span>
                        </td>
                      </tr>
                      {groupItem.list.map((employee) => (
                        <tr key={employee.id} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="py-4 px-6">
                            <div className="font-bold text-slate-900">{employee.name}</div>
                            {employee.isStaff ? (
                              <span className="inline-block mt-1 px-2 py-0.5 text-[10px] bg-slate-200 text-slate-700 rounded-full font-medium">임직원 · 고정월급</span>
                            ) : (
                              <span className="inline-block mt-1 px-2 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded-full font-medium">알바</span>
                            )}
                          </td>
                          <td className="py-4 px-6 text-slate-600 font-mono text-sm">
                            {employee.isStaff ? (
                              <span className="text-slate-400 not-italic">고정 월급</span>
                            ) : (
                              `${employee.hourlyWage.toLocaleString()}원`
                            )}
                          </td>
                          <td className="py-4 px-6 text-right space-x-2">
                            <button
                              onClick={() => handleEdit(employee)}
                              className="text-xs font-medium px-3 py-1.5 rounded bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleDelete(employee.id)}
                              className="text-xs font-medium px-3 py-1.5 rounded bg-white border border-slate-200 text-slate-600 hover:text-rose-600 hover:border-rose-200 transition-colors"
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
