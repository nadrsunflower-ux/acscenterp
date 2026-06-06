import { Employee } from '@/lib/scheduler/types';

export const initialEmployees: Employee[] = [
  // 악센트 아이디
  { id: '1', name: '김주희', hourlyWage: 0, store: 'accent-id', isStaff: true },
  { id: '2', name: '류다혜', hourlyWage: 0, store: 'accent-id', isStaff: true },
  { id: '3', name: '유선화', hourlyWage: 0, store: 'accent-id', isStaff: true },
  { id: '4', name: '이동주', hourlyWage: 0, store: 'accent-id', isStaff: true },
  { id: '5', name: '김정연', hourlyWage: 0, store: 'accent-id', isStaff: true },
  { id: '6', name: '유혜윤', hourlyWage: 10320, store: 'accent-id', isStaff: false },
  { id: '7', name: '김제연', hourlyWage: 12000, store: 'accent-id', isStaff: false, includesHolidayPay: true },

  // 악센트 와우
  { id: '8', name: '유재영', hourlyWage: 0, store: 'accent-wow', isStaff: true },
  { id: '9', name: '김주연', hourlyWage: 0, store: 'accent-wow', isStaff: true },
  { id: '10', name: '김명연', hourlyWage: 10320, store: 'accent-wow', isStaff: false },
  { id: '11', name: '장하영', hourlyWage: 10320, store: 'accent-wow', isStaff: false },
  { id: '12', name: '이우빈', hourlyWage: 10320, store: 'accent-wow', isStaff: false },
];
