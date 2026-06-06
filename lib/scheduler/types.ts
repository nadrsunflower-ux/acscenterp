export interface Employee {
  id: string;
  name: string;
  hourlyWage: number;
  store?: 'accent-id' | 'accent-wow'; // deprecated - 직원은 두 매장 모두 근무 가능
  isStaff?: boolean; // 직원 여부 (true면 시급 계산 안함)
  includesHolidayPay?: boolean; // 주휴수당 포함 여부 (김제연)
}

export interface WorkSchedule {
  id: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  hours: number;
  pay: number;
  store: 'accent-id' | 'accent-wow';
}

export interface Store {
  id: 'accent-id' | 'accent-wow';
  name: string;
  openTime: string;
  closeTime: string;
  defaultStartTime: string;
  defaultEndTime: string;
}

export const STORES: Store[] = [
  {
    id: 'accent-id',
    name: '악센트 아이디',
    openTime: '13:00',
    closeTime: '19:30',
    defaultStartTime: '12:30',
    defaultEndTime: '19:30',
  },
  {
    id: 'accent-wow',
    name: '악센트 와우',
    openTime: '12:00',
    closeTime: '19:00',
    defaultStartTime: '11:40',
    defaultEndTime: '19:00',
  },
];
