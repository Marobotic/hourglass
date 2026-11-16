// Every page: its title, icon and key (the 0.2 keys keep working), and the sidebar's groups (REDESIGN §3).
import now from './now.js';
import schedule from './schedule.js';
import attendance from './attendance.js';
import notes from './notes.js';
import note from './note.js';
import drive from './drive.js';
import alarms from './alarms.js';
import reminders from './reminders.js';
import timers from './timers.js';
import world from './world.js';
import assistant from './assistant.js';
import settings from './settings.js';
import login from './login.js';

export const PAGES = {
  now: { title: 'Now', icon: 'now', key: '1', ...now },
  schedule: { title: 'Schedule', icon: 'week', key: '2', ...schedule },
  notes: { title: 'Notes', icon: 'note', key: '3', ...notes },
  alarms: { title: 'Alarms', icon: 'bell', key: '4', ...alarms },
  timers: { title: 'Timers', icon: 'timer', key: '5', ...timers },
  world: { title: 'World clock', icon: 'globe', key: '6', ...world },
  attendance: { title: 'Attendance', icon: 'check-square', key: '7', ...attendance },
  drive: { title: 'Drive', icon: 'drive', key: '8', ...drive },
  assistant: { title: 'Assistant', icon: 'spark', key: '9', ...assistant },
  settings: { title: 'Settings', icon: 'gear', key: '0', ...settings },
  reminders: { title: 'Reminders', icon: 'reminder', key: '', ...reminders },
  note: { title: 'Note', icon: 'note', hidden: true, ...note },
  login: { title: 'Sign in', icon: 'person', hidden: true, ...login },
};

export const NAV = [
  { group: 'TODAY', pages: ['now', 'schedule', 'attendance'] },
  { group: 'WRITE', pages: ['notes', 'drive'] },
  { group: 'TIME', pages: ['alarms', 'reminders', 'timers', 'world'] },
  { group: 'ASK', pages: ['assistant'] },
];
