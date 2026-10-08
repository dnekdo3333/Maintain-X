import 'package:intl/intl.dart';

/// Display helpers (dates, money, enum labels) matching the web app's English text.

DateTime? parseDate(dynamic v) => v == null ? null : DateTime.tryParse(v.toString())?.toLocal();

String fmtDate(dynamic v) {
  final d = parseDate(v);
  return d == null ? '—' : DateFormat('d MMM yyyy').format(d);
}

String fmtDateTime(dynamic v) {
  final d = parseDate(v);
  return d == null ? '—' : DateFormat('d MMM, h:mm a').format(d);
}

String fmtTime(dynamic v) {
  final d = parseDate(v);
  return d == null ? '' : DateFormat('h:mm a').format(d);
}

String fmtRelative(dynamic v) {
  final d = parseDate(v);
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (diff.isNegative) {
    final ahead = d.difference(DateTime.now());
    if (ahead.inMinutes < 60) return 'in ${ahead.inMinutes} min';
    if (ahead.inHours < 24) return 'in ${ahead.inHours} h';
    return 'in ${ahead.inDays} d';
  }
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays < 7) return '${diff.inDays} d ago';
  return fmtDate(v);
}

String fmtMoney(dynamic v) {
  final n = v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: n % 1 == 0 ? 0 : 2)
      .format(n);
}

String fmtDuration(dynamic minutes) {
  final m = minutes is num ? minutes.round() : int.tryParse('$minutes') ?? 0;
  if (m < 60) return '$m min';
  final h = m ~/ 60, r = m % 60;
  return r == 0 ? '$h h' : '$h h $r min';
}

/// "Due in 3 h" / "Overdue by 2 d" with a tone.
({String label, String tone}) describeDue(dynamic due) {
  final d = parseDate(due);
  if (d == null) return (label: '', tone: 'neutral');
  final now = DateTime.now();
  if (d.isBefore(now)) {
    final diff = now.difference(d);
    final txt = diff.inHours < 24 ? '${diff.inHours} h' : '${diff.inDays} d';
    return (label: 'Overdue by $txt', tone: 'danger');
  }
  final diff = d.difference(now);
  final time = DateFormat('h:mm a').format(d);
  final sameDay = d.year == now.year && d.month == now.month && d.day == now.day;
  final tomorrow = now.add(const Duration(days: 1));
  final nextDay = d.year == tomorrow.year && d.month == tomorrow.month && d.day == tomorrow.day;
  if (sameDay) return (label: 'Due today, $time', tone: diff.inHours < 4 ? 'warning' : 'neutral');
  if (nextDay) return (label: 'Due tomorrow, $time', tone: 'neutral');
  return (label: 'Due ${DateFormat('d MMM, h:mm a').format(d)}', tone: 'neutral');
}

const _labels = <String, String>{
  // work order status
  'DRAFT': 'Draft', 'OPEN': 'Open', 'ASSIGNED': 'Assigned', 'SCHEDULED': 'Scheduled',
  'IN_PROGRESS': 'In progress', 'ON_HOLD': 'On hold', 'COMPLETED': 'Completed',
  'REVIEW': 'Pending verification', 'VERIFIED': 'Verified', 'CLOSED': 'Closed',
  'REOPENED': 'Reopened', 'CANCELLED': 'Cancelled',
  // request status
  'NEW': 'New', 'APPROVED': 'Approved', 'CONVERTED': 'Converted', 'REJECTED': 'Rejected',
  // priority
  'LOW': 'Low', 'MEDIUM': 'Medium', 'HIGH': 'High', 'CRITICAL': 'Critical',
  // category
  'REFRIGERATION': 'Refrigeration', 'AC': 'AC', 'ELECTRICAL': 'Electrical',
  'PLUMBING': 'Plumbing', 'GAS': 'Gas', 'FIRE_SAFETY': 'Fire safety',
  'KITCHEN_EQUIPMENT': 'Kitchen equipment', 'PEST_CONTROL': 'Pest control',
  'CLEANING': 'Cleaning', 'IT_POS': 'IT / POS', 'CIVIL': 'Civil', 'OTHER': 'Other',
  // asset status
  'OPERATIONAL': 'Operational', 'WARNING': 'Warning', 'UNDER_MAINTENANCE': 'Under maintenance',
  'BROKEN': 'Broken', 'INACTIVE': 'Inactive', 'RETIRED': 'Retired',
  // types
  'REACTIVE': 'Reactive', 'PREVENTIVE': 'Preventive', 'INSPECTION_FOLLOWUP': 'Inspection follow-up',
  'OPENING': 'Opening', 'CLOSING': 'Closing', 'SAFETY': 'Safety', 'ASSET': 'Asset',
  'SUBMITTED': 'Submitted',
  // completion
  'FULLY_WORKING': 'Fully working', 'WORKING_WITH_LIMITATIONS': 'Working with limitations',
  'NOT_WORKING': 'Not working', 'NEEDS_REPLACEMENT': 'Needs replacement',
  // evidence
  'BEFORE': 'Before', 'DURING': 'During', 'AFTER': 'After',
  // PO
  'PENDING_APPROVAL': 'Pending approval', 'ORDERED': 'Ordered',
  'PARTIALLY_RECEIVED': 'Partially received', 'RECEIVED': 'Received',
  // results
  'PASS': 'Pass', 'FAIL': 'Fail', 'NA': 'N/A',
};

String label(dynamic v) {
  if (v == null) return '—';
  final s = v.toString();
  return _labels[s] ?? s.replaceAll('_', ' ').toLowerCase().replaceFirstMapped(
      RegExp(r'^\w'), (m) => m[0]!.toUpperCase());
}

String personName(dynamic p) {
  if (p is! Map) return '—';
  return '${p['firstName'] ?? ''} ${p['lastName'] ?? ''}'.trim();
}

String initials(dynamic p) {
  if (p is! Map) return '?';
  final f = (p['firstName'] ?? '').toString(), l = (p['lastName'] ?? '').toString();
  return '${f.isNotEmpty ? f[0] : ''}${l.isNotEmpty ? l[0] : ''}'.toUpperCase();
}

const kCategories = [
  'REFRIGERATION', 'AC', 'ELECTRICAL', 'PLUMBING', 'GAS', 'FIRE_SAFETY',
  'KITCHEN_EQUIPMENT', 'PEST_CONTROL', 'CLEANING', 'IT_POS', 'CIVIL', 'OTHER',
];
const kPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const kFinalConditions = [
  'FULLY_WORKING', 'WORKING_WITH_LIMITATIONS', 'NOT_WORKING', 'NEEDS_REPLACEMENT',
];
const kActiveStatuses = [
  'DRAFT', 'OPEN', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'REVIEW', 'REOPENED',
];
