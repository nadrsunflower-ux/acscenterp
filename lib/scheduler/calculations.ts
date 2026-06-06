export const calculateHours = (startTime: string, endTime: string): number => {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);

  const startInMinutes = startHour * 60 + startMinute;
  const endInMinutes = endHour * 60 + endMinute;

  return (endInMinutes - startInMinutes) / 60;
};

export const calculatePay = (hours: number, hourlyWage: number): number => {
  return Math.round(hours * hourlyWage);
};

export const formatCurrency = (amount: number): string => {
  return amount.toLocaleString('ko-KR');
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const year = date.getFullYear().toString().slice(2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
};

export const formatDateDisplay = (dateString: string): string => {
  const date = new Date(dateString);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  return `${month}월 ${day}일 (${dayOfWeek})`;
};

// 주휴수당 계산: 주 15시간 이상 근무 시 지급
// 공식: (주 소정근로시간 ÷ 40시간) × 8시간 × 시급
export const calculateWeeklyHolidayPay = (weeklyHours: number, hourlyWage: number): number => {
  if (weeklyHours >= 15) {
    // 주 15시간 이상 근무 시 주휴수당 지급
    const holidayPay = (weeklyHours / 40) * 8 * hourlyWage;
    return Math.round(holidayPay);
  }
  return 0;
};

// 3.3% 프리랜서 세금 계산
export const calculateFreelancerTax = (amount: number): number => {
  return Math.round(amount * 0.033);
};

// 주차별로 그룹화
export const groupSchedulesByWeek = (schedules: any[]): Map<string, any[]> => {
  const weeks = new Map<string, any[]>();

  schedules.forEach(schedule => {
    const date = new Date(schedule.date);
    const weekKey = getWeekKey(date);

    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, []);
    }
    weeks.get(weekKey)!.push(schedule);
  });

  return weeks;
};

const getWeekKey = (date: Date): string => {
  const monday = new Date(date);
  const day = monday.getDay();
  const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
  monday.setDate(diff);
  return monday.toISOString().split('T')[0];
};
