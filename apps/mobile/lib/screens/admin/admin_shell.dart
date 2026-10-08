import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../shared/asset_screen.dart';
import '../shared/inspection_screens.dart';
import '../shared/misc_screens.dart';
import '../shared/report_screen.dart';
import '../shared/work_order_screen.dart';
import '../worker/worker_shell.dart' show greeting;
import 'admin_lists.dart';
import 'editors.dart';
import 'roles_screen.dart';

/// Admin app on a phone: the web's bottom tab bar (Dashboard, Work orders,
/// Requests, Assets) plus a Menu with every other module.
class AdminShell extends StatefulWidget {
  const AdminShell({super.key});
  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  int _tab = 0;
  int _unread = 0;
  Timer? _timer;
  Key _assetsKey = UniqueKey();

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

  void _openNotifications() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => NotificationsScreen(onChanged: _refreshUnread)));
    _refreshUnread();
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final tabs = <(String, IconData, IconData, Widget)>[
      if (s.can('dashboard:view')) ('Dashboard', Icons.space_dashboard_outlined, Icons.space_dashboard, const DashboardScreen()),
      if (s.can('work_orders:view')) ('Work orders', Icons.assignment_outlined, Icons.assignment, const WorkOrdersScreen()),
      if (s.can('requests:view')) ('Requests', Icons.inbox_outlined, Icons.inbox, const RequestsScreen(embedded: true)),
      if (s.can('assets:view')) ('Assets', Icons.inventory_2_outlined, Icons.inventory_2, AssetsScreen(key: _assetsKey, embedded: true)),
      ('Menu', Icons.menu, Icons.menu, const AdminMenuScreen()),
    ];
    final index = _tab.clamp(0, tabs.length - 1);
    final current = tabs[index];
    final bell = IconButton(
      onPressed: _openNotifications,
      icon: Badge(
        isLabelVisible: _unread > 0,
        label: Text(_unread > 99 ? '99+' : '$_unread'),
        child: const Icon(Icons.notifications_none),
      ),
    );
    return Scaffold(
      appBar: current.$1 == 'Menu' ? null : AppBar(title: Text(current.$1), actions: [bell, const SizedBox(width: 4)]),
      body: current.$4,
      floatingActionButton: switch (current.$1) {
        'Work orders' when s.can('work_orders:create') => FloatingActionButton.extended(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateWorkOrderScreen())),
            icon: const Icon(Icons.add),
            label: const Text('New work order'),
          ),
        'Assets' when canManage(context, 'assets:create') => FloatingActionButton.extended(
            onPressed: () async {
              if (await openEditor(context, const AssetForm())) setState(() => _assetsKey = UniqueKey());
            },
            icon: const Icon(Icons.add),
            label: const Text('Add asset'),
          ),
        'Requests' => FloatingActionButton.extended(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ReportScreen())),
            icon: const Icon(Icons.add),
            label: const Text('New request'),
          ),
        _ => null,
      },
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [
          for (final t in tabs) NavigationDestination(icon: Icon(t.$2), selectedIcon: Icon(t.$3), label: t.$1),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- dashboard

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    void openWo(Map w) =>
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: w['id'].toString())));
    return DataView<Json>(
      load: () => s.api.getData<Json>('/dashboard'),
      builder: (context, d, reload) {
        final c = (d['counts'] as Map?) ?? const {};
        final today = (d['today'] as Map?) ?? const {};
        final critical = (d['criticalIssues'] as List?) ?? const [];
        final overdue = (d['overdueTasks'] as List?) ?? const [];
        final todays = (d['todaysTasks'] as List?) ?? const [];
        final restaurants = (d['restaurants'] as List?) ?? const [];
        final workload = (d['workload'] as List?) ?? const [];
        final cost = (d['cost'] as Map?) ?? const {};
        final kpis = <(String, dynamic, IconData, String)>[
          ('Open work orders', c['open'], Icons.assignment_outlined, 'info'),
          ('Overdue', c['overdue'], Icons.alarm, 'danger'),
          ('In progress', c['inProgress'], Icons.timer_outlined, 'warning'),
          ('Pending verification', c['pendingVerification'], Icons.verified_outlined, 'info'),
          ('Completed (30 d)', c['completed30d'], Icons.task_alt, 'success'),
          ('Open requests', c['openRequests'], Icons.inbox_outlined, 'info'),
          ('Assets down', c['assetsDown'], Icons.report_problem_outlined, 'danger'),
          ('Low stock parts', c['lowStock'], Icons.inventory_2_outlined, 'warning'),
        ];
        return ListView(padding: const EdgeInsets.all(16), children: [
          BrandHero(
            overline: '${c['activeRestaurants'] ?? 0} restaurants · ${c['activeWorkers'] ?? 0} technicians',
            title: greeting(s.firstName),
            subtitle: 'Today: ${today['created'] ?? 0} new · ${today['completed'] ?? 0} completed · ${today['critical'] ?? 0} critical',
          ),
          const SizedBox(height: 16),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.6,
            children: [
              for (final k in kpis)
                AppCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    IconChip(k.$3, tone: k.$4, size: 32),
                    Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${k.$2 ?? 0}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600, height: 1)),
                      const SizedBox(height: 3),
                      Text(k.$1, style: const TextStyle(fontSize: 12.5, color: AppColors.muted), maxLines: 1, overflow: TextOverflow.ellipsis),
                    ]),
                  ]),
                ),
            ],
          ),
          const SizedBox(height: 14),
          AppCard(
            child: Row(children: [
              _Metric('PM compliance', '${d['pmCompliance'] ?? '—'}%'),
              _Metric('On time', '${d['onTimeRate'] ?? '—'}%'),
              _Metric('MTTR', '${d['mttrHours'] ?? '—'} h'),
              _Metric('Downtime', '${d['downtimeHours'] ?? 0} h'),
            ]),
          ),
          const SizedBox(height: 10),
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Maintenance cost (30 days)', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text(fmtMoney(cost['total']), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              _CostBar(cost: cost),
            ]),
          ),
          if (critical.isNotEmpty) ...[
            const SizedBox(height: 18),
            const SectionTitle('Critical issues'),
            for (final w in critical)
              Padding(padding: const EdgeInsets.only(bottom: 10), child: TaskCard(task: w as Map, showAssignee: true, onTap: () => openWo(w))),
          ],
          if (overdue.isNotEmpty) ...[
            const SizedBox(height: 8),
            const SectionTitle('Overdue'),
            for (final w in overdue)
              Padding(padding: const EdgeInsets.only(bottom: 10), child: TaskCard(task: {...w as Map, 'overdue': true}, showAssignee: true, onTap: () => openWo(w))),
          ],
          if (todays.isNotEmpty) ...[
            const SizedBox(height: 8),
            const SectionTitle('Today’s tasks'),
            for (final w in todays)
              Padding(padding: const EdgeInsets.only(bottom: 10), child: TaskCard(task: w as Map, showAssignee: true, onTap: () => openWo(w))),
          ],
          if (workload.isNotEmpty) ...[
            const SizedBox(height: 8),
            const SectionTitle('Technician workload'),
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (final wl in workload)
                  ListTile(
                    leading: Avatar((wl as Map)['user'], size: 34),
                    title: Text(personName(wl['user'])),
                    subtitle: Text('${wl['open']} open · ${wl['inProgress']} in progress · ${wl['completed']} done'),
                    trailing: (wl['overdue'] ?? 0) > 0 ? Pill('${wl['overdue']} overdue', tone: 'danger') : null,
                  ),
              ]),
            ),
          ],
          if (restaurants.isNotEmpty) ...[
            const SizedBox(height: 18),
            const SectionTitle('Restaurants'),
            for (final r in restaurants)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: AppCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text((r as Map)['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      Pill('${r['open']} open', tone: 'info'),
                      if ((r['overdue'] ?? 0) > 0) Pill('${r['overdue']} overdue', tone: 'danger'),
                      if ((r['critical'] ?? 0) > 0) Pill('${r['critical']} critical', tone: 'danger'),
                      Pill('${r['completed']} completed', tone: 'success'),
                      if ((r['assetsDown'] ?? 0) > 0) Pill('${r['assetsDown']} assets down', tone: 'warning'),
                      Pill(fmtMoney(r['cost'])),
                    ]),
                  ]),
                ),
              ),
          ],
        ]);
      },
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(children: [
          Text(value, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
        ]),
      );
}

class _CostBar extends StatelessWidget {
  const _CostBar({required this.cost});
  final Map cost;
  @override
  Widget build(BuildContext context) {
    final parts = <(String, num, Color)>[
      ('Parts', (cost['parts'] ?? 0) as num, AppColors.info),
      ('Labour', (cost['labour'] ?? 0) as num, AppColors.success),
      ('Vendor', (cost['vendor'] ?? 0) as num, AppColors.brandTo),
      ('Other', (cost['other'] ?? 0) as num, AppColors.warning),
    ];
    final total = parts.fold<num>(0, (a, b) => a + b.$2);
    if (total <= 0) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: Row(children: [
          for (final p in parts)
            if (p.$2 > 0) Expanded(flex: (p.$2 / total * 1000).round().clamp(1, 1000), child: Container(height: 10, color: p.$3)),
        ]),
      ),
      const SizedBox(height: 8),
      Wrap(spacing: 12, runSpacing: 4, children: [
        for (final p in parts)
          Row(mainAxisSize: MainAxisSize.min, children: [
            Container(width: 10, height: 10, decoration: BoxDecoration(color: p.$3, borderRadius: BorderRadius.circular(3))),
            const SizedBox(width: 4),
            Text('${p.$1} ${fmtMoney(p.$2)}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          ]),
      ]),
    ]);
  }
}

// ---------------------------------------------------------------- work orders

class WorkOrdersScreen extends StatefulWidget {
  const WorkOrdersScreen({super.key});
  @override
  State<WorkOrdersScreen> createState() => _WorkOrdersScreenState();
}

class _WorkOrdersScreenState extends State<WorkOrdersScreen> {
  static const _filters = <(String, String, Map<String, String>)>[
    ('active', 'Active', {'view': 'active'}),
    ('overdue', 'Overdue', {'view': 'overdue'}),
    ('open', 'Unassigned', {'view': 'unassigned'}),
    ('progress', 'In progress', {'status': 'IN_PROGRESS'}),
    ('hold', 'On hold', {'status': 'ON_HOLD'}),
    ('review', 'To verify', {'view': 'review'}),
    ('done', 'Done', {'view': 'done'}),
  ];
  String _filter = 'active';
  String _q = '';
  final _key = GlobalKey<DataViewState<List>>();

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final f = _filters.firstWhere((x) => x.$1 == _filter);
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: TextField(
          decoration: const InputDecoration(hintText: 'Search work orders', prefixIcon: Icon(Icons.search), isDense: true),
          onSubmitted: (v) {
            _q = v;
            _key.currentState?.reload();
          },
        ),
      ),
      SizedBox(
        height: 48,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(16, 6, 16, 0), children: [
          for (final x in _filters)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(x.$2),
                selected: _filter == x.$1,
                onSelected: (_) {
                  setState(() => _filter = x.$1);
                  _key.currentState?.reload();
                },
              ),
            ),
        ]),
      ),
      Expanded(
        child: DataView<List>(
          key: _key,
          load: () async {
            final res = await api.get('/work-orders', {
              'pageSize': 100,
              'q': _q,
              'sort': _filter == 'done' ? 'createdAt:desc' : 'dueDate:asc',
              ...f.$3,
            }) as Map;
            return res['data'] as List;
          },
          builder: (context, items, reload) => items.isEmpty
              ? ListView(children: const [EmptyState(icon: Icons.assignment_outlined, title: 'No work orders here')])
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 90),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, i) => TaskCard(
                    task: items[i] as Map,
                    showAssignee: true,
                    onTap: () async {
                      await Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => WorkOrderScreen(id: (items[i] as Map)['id'].toString())));
                      reload();
                    },
                  ),
                ),
        ),
      ),
    ]);
  }
}

class CreateWorkOrderScreen extends StatefulWidget {
  const CreateWorkOrderScreen({super.key});
  @override
  State<CreateWorkOrderScreen> createState() => _CreateWorkOrderScreenState();
}

class _CreateWorkOrderScreenState extends State<CreateWorkOrderScreen> {
  final _title = TextEditingController();
  final _desc = TextEditingController();
  String? _restaurantId;
  String? _locationId;
  String? _assetId;
  String? _assigneeId;
  String _category = 'OTHER';
  String _priority = 'MEDIUM';
  DateTime? _due;
  List _locations = const [];
  List _assets = const [];
  List _people = const [];
  bool _busy = false;

  ApiClient get api => apiOf(context);

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId = rs.isNotEmpty ? rs.first['id'].toString() : null;
    _loadRestaurant();
  }

  Future<void> _loadRestaurant() async {
    final rid = _restaurantId;
    if (rid == null) return;
    try {
      final results = await Future.wait([
        api.getData<List>('/locations', {'restaurantId': rid}),
        api.get('/assets', {'restaurantId': rid, 'pageSize': 100, 'sort': 'name:asc'}),
        api.getData<List>('/work-orders/workload', {'restaurantId': rid}),
      ]);
      if (!mounted) return;
      setState(() {
        _locations = results[0] as List;
        _assets = (results[1] as Map)['data'] as List;
        _people = results[2] as List;
      });
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    }
  }

  Future<void> _pickDue() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 365)), initialDate: _due ?? now);
    if (d == null || !mounted) return;
    final t = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 18, minute: 0));
    setState(() => _due = DateTime(d.year, d.month, d.day, t?.hour ?? 18, t?.minute ?? 0));
  }

  Future<void> _save() async {
    if (_title.text.trim().length < 3 || _restaurantId == null) {
      toast(context, 'Title (3+ letters) aur restaurant zaroori hai', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final wo = await api.postData<Json>('/work-orders', {
        'title': _title.text.trim(),
        'description': _desc.text.trim(),
        'category': _category,
        'priority': _priority,
        'restaurantId': _restaurantId,
        'locationId': _locationId ?? '',
        'assetId': _assetId ?? '',
        'dueDate': _due?.toUtc().toIso8601String() ?? '',
        'assignedUserId': _assigneeId ?? '',
        'assignedTeamId': '',
        // Required by the API; '' = not created from a request.
        'requestId': '',
      });
      if (!mounted) return;
      toast(context, 'Work order ${wo['code']} created');
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: wo['id'].toString())));
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rs = context.watch<Session>().restaurants;
    return Scaffold(
      appBar: AppBar(title: const Text('New work order')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _title, decoration: const InputDecoration(labelText: 'Title *', hintText: 'e.g. Fridge not cooling')),
        const SizedBox(height: 12),
        TextField(controller: _desc, minLines: 3, maxLines: 6, decoration: const InputDecoration(labelText: 'Description', alignLabelWithHint: true)),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _restaurantId,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Restaurant *'),
          items: [for (final r in rs) DropdownMenuItem(value: r['id'].toString(), child: Text(r['name'].toString()))],
          onChanged: (v) {
            setState(() {
              _restaurantId = v;
              _locationId = null;
              _assetId = null;
              _assigneeId = null;
            });
            _loadRestaurant();
          },
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String?>(
          key: ValueKey('l-$_restaurantId-${_locations.length}'),
          initialValue: _locationId,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Location'),
          items: [
            const DropdownMenuItem(value: null, child: Text('—')),
            for (final l in _locations) DropdownMenuItem(value: (l as Map)['id'].toString(), child: Text(l['name'].toString())),
          ],
          onChanged: (v) => setState(() => _locationId = v),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String?>(
          key: ValueKey('a-$_restaurantId-${_assets.length}'),
          initialValue: _assetId,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Asset'),
          items: [
            const DropdownMenuItem(value: null, child: Text('—')),
            for (final a in _assets) DropdownMenuItem(value: (a as Map)['id'].toString(), child: Text('${a['name']} · ${a['assetCode']}')),
          ],
          onChanged: (v) => setState(() => _assetId = v),
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _category,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Category'),
              items: [for (final c in kCategories) DropdownMenuItem(value: c, child: Text(label(c)))],
              onChanged: (v) => setState(() => _category = v ?? _category),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _priority,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Priority'),
              items: [for (final p in kPriorities) DropdownMenuItem(value: p, child: Text(label(p)))],
              onChanged: (v) => setState(() => _priority = v ?? _priority),
            ),
          ),
        ]),
        const SizedBox(height: 12),
        DropdownButtonFormField<String?>(
          key: ValueKey('p-$_restaurantId-${_people.length}'),
          initialValue: _assigneeId,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Assign to'),
          items: [
            const DropdownMenuItem(value: null, child: Text('Leave unassigned')),
            for (final p in _people)
              DropdownMenuItem(
                value: ((p as Map)['user'] as Map)['id'].toString(),
                child: Text('${personName(p['user'])} · ${p['openCount']} open'),
              ),
          ],
          onChanged: (v) => setState(() => _assigneeId = v),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _pickDue,
          icon: const Icon(Icons.event_outlined),
          label: Text(_due == null ? 'Set due date' : 'Due ${fmtDateTime(_due!.toIso8601String())}'),
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: _busy ? null : _save,
          icon: const Icon(Icons.check),
          label: const Text('Create work order'),
        ),
      ]),
    );
  }
}

// ---------------------------------------------------------------- menu

class AdminMenuScreen extends StatelessWidget {
  const AdminMenuScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    void go(Widget page) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
    final groups = <(String, List<(IconData, String, Widget, bool)>)>[
      ('Work', [
        (Icons.notifications_none, 'Notifications', const NotificationsScreen(), true),
        (Icons.forum_outlined, 'Chat', const ChatListScreen(), true),
        (Icons.fact_check_outlined, 'Inspections', const InspectionsScreen(), s.can('inspections:view')),
        (Icons.qr_code_scanner, 'Scan QR', const ScanScreen(), s.can('assets:view')),
      ]),
      ('Purchasing', [
        (Icons.inventory_2_outlined, 'Inventory', const PartsScreen(), s.can('parts:view')),
        (Icons.receipt_long_outlined, 'Purchase orders', const PurchaseOrdersScreen(), s.can('purchase_orders:view')),
        (Icons.local_shipping_outlined, 'Vendors', const VendorsScreen(), s.can('vendors:view')),
      ]),
      ('Organization', [
        (Icons.storefront_outlined, 'Restaurants', const AdminRestaurantsScreen(), s.can('restaurants:view')),
        (Icons.groups_outlined, 'Teams', const TeamsScreen(), s.can('teams:view')),
        (Icons.description_outlined, 'Documents', const DocumentsScreen(), s.can('documents:view')),
        (Icons.people_outline, 'Users', const UsersScreen(), s.can('users:view')),
      ]),
      ('Administration', [
        // Who can do what: Super Admin only.
        (Icons.admin_panel_settings_outlined, 'Roles & permissions', const RolesScreen(), s.isSuperAdmin),
      ]),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('Menu')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        AppCard(
          onTap: () => go(const ProfileScreen()),
          child: Row(children: [
            Avatar(s.user, size: 46),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.fullName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                Text(s.roleName, style: const TextStyle(color: AppColors.muted)),
              ]),
            ),
            const Icon(Icons.chevron_right, color: AppColors.muted),
          ]),
        ),
        for (final g in groups)
          if (g.$2.any((i) => i.$4)) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
              child: Text(g.$1.toUpperCase(),
                  style: const TextStyle(fontSize: 11.5, letterSpacing: 0.8, fontWeight: FontWeight.w600, color: AppColors.muted)),
            ),
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (final (i, it) in g.$2.where((x) => x.$4).indexed) ...[
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
          ],
        const SizedBox(height: 20),
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
