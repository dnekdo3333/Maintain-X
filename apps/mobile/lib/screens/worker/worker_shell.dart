import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../shared/asset_screen.dart';
import '../shared/inspection_screens.dart';
import '../shared/misc_screens.dart';
import '../shared/report_screen.dart';
import '../shared/work_order_screen.dart';

String greeting(String name) {
  final h = DateTime.now().hour;
  final part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return '$part, $name';
}

/// Worker app: Home · My tasks (or My reports for staff) · Scan · Alerts · More.
class WorkerShell extends StatefulWidget {
  const WorkerShell({super.key});
  @override
  State<WorkerShell> createState() => _WorkerShellState();
}

class _WorkerShellState extends State<WorkerShell> {
  int _tab = 0;
  int _unread = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _refreshUnread();
    _timer = Timer.periodic(const Duration(minutes: 2), (_) => _refreshUnread());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refreshUnread() async {
    try {
      final r = await apiOf(context).getData<Json>('/notifications/unread-count');
      if (mounted) setState(() => _unread = (r['count'] ?? 0) as int);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final doesWork = s.can('work_orders:view');
    final pages = <Widget>[
      doesWork ? WorkerHome(onTab: (i) => setState(() => _tab = i)) : const RequesterHome(),
      doesWork ? const WorkerTasksScreen() : const RequestsScreen(mine: true),
      const ScanScreen(),
      NotificationsScreen(embedded: true, onChanged: _refreshUnread),
      const WorkerMoreScreen(),
    ];
    return Scaffold(
      // Only the open tab is built, so the camera runs only on Scan.
      body: pages[_tab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) {
          setState(() => _tab = i);
          if (i == 3) _refreshUnread();
        },
        destinations: [
          const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          doesWork
              ? const NavigationDestination(
                  icon: Icon(Icons.assignment_outlined), selectedIcon: Icon(Icons.assignment), label: 'My tasks')
              : const NavigationDestination(
                  icon: Icon(Icons.inbox_outlined), selectedIcon: Icon(Icons.inbox), label: 'My reports'),
          const NavigationDestination(icon: Icon(Icons.qr_code_scanner), label: 'Scan'),
          NavigationDestination(
            icon: Badge(isLabelVisible: _unread > 0, label: Text(_unread > 9 ? '9+' : '$_unread'), child: const Icon(Icons.notifications_none)),
            selectedIcon: Badge(isLabelVisible: _unread > 0, label: Text(_unread > 9 ? '9+' : '$_unread'), child: const Icon(Icons.notifications)),
            label: 'Alerts',
          ),
          const NavigationDestination(icon: Icon(Icons.menu), label: 'More'),
        ],
      ),
    );
  }
}

class WorkerHome extends StatelessWidget {
  const WorkerHome({super.key, required this.onTab});
  final void Function(int) onTab;

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final api = s.api;
    final today = DateFormat('EEEE, d MMMM').format(DateTime.now());
    return SafeArea(
      child: DataView<Json>(
        load: () => api.getData<Json>('/me/home'),
        builder: (context, home, reload) {
          final c = (home['counts'] as Map?) ?? const {};
          final next = (home['next'] as List?) ?? const [];
          final waiting = ((c['today'] ?? 0) as int) + ((c['overdue'] ?? 0) as int);
          void openTasks([String view = 'today', String? priority, bool pm = false]) => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => WorkerTasksScreen(initialView: view, priority: priority, pmOnly: pm, standalone: true)));
          final stats = <(String, dynamic, IconData, String, VoidCallback, bool)>[
            ('Today', c['today'], Icons.list_alt, 'info', () => onTab(1), false),
            ('Overdue', c['overdue'], Icons.alarm, 'danger', () => openTasks('overdue'), (c['overdue'] ?? 0) > 0),
            ('In progress', c['inProgress'], Icons.timer_outlined, 'warning', () => onTab(1), false),
            ('Done this week', c['doneThisWeek'], Icons.event_available, 'success', () => openTasks('done'), false),
            ('High priority', c['highPriority'], Icons.local_fire_department_outlined, 'danger', () => openTasks('upcoming', 'CRITICAL'), false),
            ('Preventive', c['preventive'], Icons.build_outlined, 'info', () => openTasks('upcoming', null, true), false),
            ('Checklists due', c['checklistsDue'], Icons.fact_check_outlined, 'warning',
                () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ChecklistsScreen())), false),
          ];
          return ListView(padding: const EdgeInsets.all(16), children: [
            BrandHero(
              overline: today,
              title: greeting(s.firstName),
              subtitle: waiting > 0
                  ? 'You have $waiting task${waiting == 1 ? '' : 's'} waiting today.'
                  : 'Nothing urgent right now. Great work!',
            ),
            const SizedBox(height: 18),
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 1.45,
              children: [
                for (final st in stats)
                  AppCard(
                    onTap: st.$5,
                    borderColor: st.$6 ? AppColors.danger.withValues(alpha: 0.4) : null,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      Row(children: [
                        IconChip(st.$3, tone: st.$4, size: 34),
                        const Spacer(),
                        if (st.$6) const CircleAvatar(radius: 5, backgroundColor: AppColors.danger),
                      ]),
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${st.$2 ?? 0}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w600, height: 1)),
                        const SizedBox(height: 4),
                        Text(st.$1, style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                      ]),
                    ]),
                  ),
              ],
            ),
            const SizedBox(height: 20),
            SectionTitle('Next up',
                trailing: next.isEmpty ? null : TextButton(onPressed: () => onTab(1), child: const Text('See all'))),
            if (next.isEmpty)
              const AppCard(child: EmptyState(icon: Icons.done_all, title: 'All caught up!', body: 'No tasks for today.'))
            else
              for (final t in next)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(
                    task: t as Map,
                    onTap: () async {
                      await Navigator.of(context)
                          .push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: t['id'].toString())));
                      reload();
                    },
                  ),
                ),
            const SizedBox(height: 14),
            const SectionTitle('Quick actions'),
            _QuickAction(
              icon: Icons.campaign_outlined,
              title: 'Report a problem',
              hint: 'Something broken? Tell us in seconds',
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ReportScreen())),
            ),
            _QuickAction(icon: Icons.qr_code_scanner, title: 'Scan', hint: 'Open any machine from its QR code', onTap: () => onTab(2)),
            _QuickAction(
              icon: Icons.fact_check_outlined,
              title: 'Checklists',
              hint: 'Opening, closing and safety checks',
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ChecklistsScreen())),
            ),
          ]);
        },
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({required this.icon, required this.title, required this.hint, required this.onTap});
  final IconData icon;
  final String title;
  final String hint;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: AppCard(
          onTap: onTap,
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            IconChip(icon, brand: true, size: 40),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(hint, style: const TextStyle(fontSize: 12.5, color: AppColors.muted), overflow: TextOverflow.ellipsis),
              ]),
            ),
            const Icon(Icons.chevron_right, color: AppColors.muted),
          ]),
        ),
      );
}

/// Restaurant staff (requesters): one big report button and their reports.
class RequesterHome extends StatelessWidget {
  const RequesterHome({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    return SafeArea(
      child: DataView<List>(
        load: () async => (await s.api.get('/requests', {'mine': '1', 'pageSize': 5}) as Map)['data'] as List,
        builder: (context, reports, reload) => ListView(padding: const EdgeInsets.all(16), children: [
          BrandHero(title: greeting(s.firstName), subtitle: 'Something not working? Report it and follow it here.'),
          const SizedBox(height: 16),
          _QuickAction(
            icon: Icons.campaign_outlined,
            title: 'Report a problem',
            hint: 'Something broken? Tell us in seconds',
            onTap: () async {
              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ReportScreen()));
              reload();
            },
          ),
          const SizedBox(height: 12),
          const SectionTitle('My reports'),
          if (reports.isEmpty)
            const AppCard(child: EmptyState(icon: Icons.campaign_outlined, title: 'No reports yet', body: 'Problems you report will show here.')),
          for (final r in reports)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: AppCard(
                onTap: () => Navigator.of(context)
                    .push(MaterialPageRoute(builder: (_) => RequestScreen(id: r['id'].toString()))),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text((r as Map)['title'].toString(), style: const TextStyle(fontWeight: FontWeight.w500)),
                      Text('${r['code']}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                    ]),
                  ),
                  StatusBadge(r['status']?.toString()),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

/// My work: Today / Upcoming / Overdue / Done, with priority and PM filters.
class WorkerTasksScreen extends StatefulWidget {
  const WorkerTasksScreen({super.key, this.initialView = 'today', this.priority, this.pmOnly = false, this.standalone = false});
  final String initialView;
  final String? priority;
  final bool pmOnly;
  final bool standalone;
  @override
  State<WorkerTasksScreen> createState() => _WorkerTasksScreenState();
}

class _WorkerTasksScreenState extends State<WorkerTasksScreen> with SingleTickerProviderStateMixin {
  static const _views = ['today', 'upcoming', 'overdue', 'done'];
  static const _labels = ['Today', 'Upcoming', 'Overdue', 'Done'];
  late final TabController _tabs;
  String? _priority;
  late bool _pm;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 4, vsync: this, initialIndex: _views.indexOf(widget.initialView).clamp(0, 3));
    _priority = widget.priority;
    _pm = widget.pmOnly;
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My tasks'),
        automaticallyImplyLeading: widget.standalone,
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: [for (final l in _labels) Tab(text: l)],
        ),
      ),
      body: Column(children: [
        SizedBox(
          height: 52,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(16, 8, 16, 4), children: [
            FilterChip(
              label: Text(_priority == null ? 'Priority' : 'Priority: ${_priority![0]}${_priority!.substring(1).toLowerCase()}'),
              selected: _priority != null,
              onSelected: (_) async {
                final p = await pickOption<String>(context, 'Priority', [
                  ('', 'Any'),
                  ('CRITICAL', 'Critical'),
                  ('HIGH', 'High'),
                  ('MEDIUM', 'Medium'),
                  ('LOW', 'Low'),
                ]);
                if (p != null) setState(() => _priority = p.isEmpty ? null : p);
              },
            ),
            const SizedBox(width: 8),
            FilterChip(
              avatar: const Icon(Icons.build_outlined, size: 16),
              label: const Text('Preventive only'),
              selected: _pm,
              onSelected: (v) => setState(() => _pm = v),
            ),
          ]),
        ),
        Expanded(
          child: TabBarView(controller: _tabs, children: [
            for (final v in _views)
              _TaskList(key: ValueKey('$v-$_priority-$_pm'), view: v, priority: _priority, pm: _pm),
          ]),
        ),
      ]),
    );
  }
}

class _TaskList extends StatelessWidget {
  const _TaskList({super.key, required this.view, this.priority, this.pm = false});
  final String view;
  final String? priority;
  final bool pm;
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return DataView<List>(
      load: () async => (await api.get('/me/tasks', {
        'view': view,
        'priority': priority,
        if (pm) 'pm': '1',
        'pageSize': 50,
      }) as Map)['data'] as List,
      builder: (context, tasks, reload) {
        if (tasks.isEmpty) {
          final (icon, title) = switch (view) {
            'upcoming' => (Icons.event_available_outlined, 'Nothing coming up'),
            'overdue' => (Icons.alarm_on_outlined, 'Nothing overdue'),
            'done' => (Icons.history, 'No finished tasks yet'),
            _ => (Icons.done_all, 'All caught up!'),
          };
          return ListView(children: [EmptyState(icon: icon, title: title)]);
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          itemCount: tasks.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (context, i) => TaskCard(
            task: tasks[i] as Map,
            onTap: () async {
              await Navigator.of(context)
                  .push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: (tasks[i] as Map)['id'].toString())));
              reload();
            },
          ),
        );
      },
    );
  }
}

class WorkerMoreScreen extends StatelessWidget {
  const WorkerMoreScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final doesWork = s.can('work_orders:view');
    void go(Widget page) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
    final items = <(IconData, String, Widget)>[
      (Icons.campaign_outlined, 'Report a problem', const ReportScreen()),
      (Icons.forum_outlined, 'Chat', const ChatListScreen()),
      if (doesWork) (Icons.calendar_month_outlined, 'Schedule', const ScheduleScreen()),
      if (s.can('inspections:view')) (Icons.fact_check_outlined, 'Checklists', const ChecklistsScreen()),
      if (doesWork) (Icons.inbox_outlined, 'My reports', const RequestsScreen(mine: true)),
      (Icons.inventory_2_outlined, 'My assets', const AssetsScreen()),
      (Icons.storefront_outlined, 'My restaurants', const RestaurantsScreen()),
      (Icons.person_outline, 'Profile', const ProfileScreen()),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        AppCard(
          child: Row(children: [
            Avatar(s.user, size: 46),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.fullName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                Text(s.roleName, style: const TextStyle(color: AppColors.muted)),
              ]),
            ),
          ]),
        ),
        const SizedBox(height: 14),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(children: [
            for (final (i, it) in items.indexed) ...[
              if (i > 0) const Divider(indent: 56),
              ListTile(
                leading: Icon(it.$1, color: AppColors.primary),
                title: Text(it.$2),
                trailing: const Icon(Icons.chevron_right, color: AppColors.muted),
                onTap: () => go(it.$3),
              ),
            ],
          ]),
        ),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
          onPressed: () async {
            if (await confirm(context, 'Sign out?', action: 'Sign out') && context.mounted) {
              await context.read<Session>().logout();
            }
          },
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
        ),
      ]),
    );
  }
}
