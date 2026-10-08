import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/forms.dart';
import 'editors.dart';

/// What each module allows (mirrors RESOURCE_ACTIONS in packages/shared/src/permissions.ts).
const kResourceActions = <String, List<String>>{
  'dashboard': ['view'],
  'restaurants': ['view', 'create', 'edit', 'delete', 'export'],
  'locations': ['view', 'create', 'edit', 'delete', 'export'],
  'users': ['view', 'create', 'edit', 'delete', 'assign', 'export'],
  'roles': ['view', 'create', 'edit', 'delete', 'assign', 'export'],
  'teams': ['view', 'create', 'edit', 'delete', 'assign', 'export'],
  'assets': ['view', 'create', 'edit', 'delete', 'export'],
  'qr': ['view', 'create', 'export'],
  'requests': ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export'],
  'work_orders': ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'complete', 'close', 'export'],
  'maintenance': ['view', 'create', 'edit', 'delete', 'assign', 'export'],
  'procedures': ['view', 'create', 'edit', 'delete', 'export'],
  'inspections': ['view', 'create', 'edit', 'delete', 'export'],
  'inventory': ['view', 'create', 'edit', 'delete', 'export'],
  'parts': ['view', 'create', 'edit', 'delete', 'export'],
  'vendors': ['view', 'create', 'edit', 'delete', 'export'],
  'purchase_orders': ['view', 'create', 'edit', 'delete', 'approve', 'export'],
  'documents': ['view', 'create', 'edit', 'delete'],
  'messages': ['view', 'create'],
  'notifications': ['view', 'edit'],
  'reports': ['view', 'export'],
  'audit_logs': ['view', 'export'],
  'settings': ['view', 'edit'],
  'meters': ['view', 'create', 'edit', 'delete'],
  'automations': ['view', 'create', 'edit', 'delete'],
};

/// Never given to a role (Super Admin only) — SUPER_ADMIN_ONLY_RESOURCES.
const _superAdminOnly = {'roles', 'settings'};

/// The most a worker-app role may have — WORKER_PERMISSION_FLOOR.
const _workerAllowed = {
  'dashboard:view', 'restaurants:view', 'locations:view', 'assets:view', 'qr:view',
  'requests:view', 'requests:create', 'work_orders:view', 'work_orders:edit', 'work_orders:complete',
  'maintenance:view', 'procedures:view', 'inspections:view', 'inspections:create', 'inspections:edit',
  'inventory:view', 'parts:view', 'documents:view', 'documents:create', 'messages:view', 'messages:create',
  'notifications:view', 'notifications:edit', 'meters:view', 'meters:create',
};

const _resourceNames = <String, String>{
  'dashboard': 'Dashboard', 'restaurants': 'Restaurants', 'locations': 'Locations', 'users': 'Users',
  'roles': 'Roles', 'teams': 'Teams', 'assets': 'Assets', 'qr': 'QR codes', 'requests': 'Requests',
  'work_orders': 'Work orders', 'maintenance': 'Preventive maintenance', 'procedures': 'Procedures',
  'inspections': 'Inspections / checklists', 'inventory': 'Stock', 'parts': 'Parts', 'vendors': 'Vendors',
  'purchase_orders': 'Purchase orders', 'documents': 'Documents', 'messages': 'Messages',
  'notifications': 'Notifications', 'reports': 'Reports', 'audit_logs': 'Audit log', 'settings': 'Settings',
  'meters': 'Meters', 'automations': 'Automations',
};

const _actionNames = <String, String>{
  'view': 'View', 'create': 'Create', 'edit': 'Edit', 'delete': 'Remove', 'assign': 'Assign',
  'approve': 'Approve / verify', 'complete': 'Complete own work', 'close': 'Close / cancel', 'export': 'Export',
};

/// Roles list (Super Admin): who can do what. Tap a role to change its access.
class RolesScreen extends StatefulWidget {
  const RolesScreen({super.key});
  @override
  State<RolesScreen> createState() => _RolesScreenState();
}

class _RolesScreenState extends State<RolesScreen> {
  final _key = GlobalKey<DataViewState<List>>();

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Roles & permissions')),
      floatingActionButton: canManage(context, 'roles:create')
          ? FloatingActionButton.extended(
              onPressed: () async {
                if (await openEditor(context, const RoleForm())) _key.currentState?.reload();
              },
              icon: const Icon(Icons.add),
              label: const Text('New role'),
            )
          : null,
      body: DataView<List>(
        key: _key,
        load: () => api.getData<List>('/roles'),
        builder: (context, roles, reload) => ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 96), children: [
          const Callout(
            text: 'Choose exactly what each role can see and do. Give a person a role from Users → Edit user. '
                'Restaurant access is chosen per user.',
          ),
          const SizedBox(height: 12),
          for (final r in roles)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: AppCard(
                onTap: (r as Map)['locked'] == true
                    ? () => toast(context, 'Super Admin always has full access.')
                    : () async {
                        if (await openEditor(context, RoleForm(existing: r.cast<String, dynamic>()))) reload();
                      },
                child: Row(children: [
                  IconChip(r['kind'] == 'ADMIN' ? Icons.admin_panel_settings_outlined : Icons.engineering_outlined,
                      brand: r['locked'] == true),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(r['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                      if (r['description'] != null)
                        Text(r['description'].toString(),
                            maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                      const SizedBox(height: 4),
                      Wrap(spacing: 6, runSpacing: 4, children: [
                        Pill(r['kind'] == 'ADMIN' ? 'Manager app' : 'Worker app', tone: r['kind'] == 'ADMIN' ? 'info' : 'neutral'),
                        Pill('${r['userCount'] ?? 0} users'),
                        Pill('${(r['permissions'] as List?)?.length ?? 0} permissions', tone: 'success'),
                        if (r['locked'] == true) const Pill('Full access', tone: 'warning'),
                        if (r['isSystem'] != true) const Pill('Custom', tone: 'info'),
                      ]),
                    ]),
                  ),
                  Icon(r['locked'] == true ? Icons.lock_outline : Icons.chevron_right, color: AppColors.muted),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

class RoleForm extends StatefulWidget {
  const RoleForm({super.key, this.existing});
  final Json? existing;
  @override
  State<RoleForm> createState() => _RoleFormState();
}

class _RoleFormState extends State<RoleForm> {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _desc = TextEditingController(text: e['description'] ?? '');
  late String _kind = e['kind'] ?? 'WORKER';
  late final Set<String> _perms = {for (final p in (e['permissions'] as List? ?? const [])) p.toString()};
  bool _busy = false;

  bool get _system => e['isSystem'] == true;

  bool _allowed(String key) => _kind == 'ADMIN' || _workerAllowed.contains(key);

  /// Modules and actions this role type may have.
  Map<String, List<String>> get _matrix => {
        for (final e in kResourceActions.entries)
          if (!_superAdminOnly.contains(e.key))
            if (e.value.where((a) => _allowed('${e.key}:$a')).isNotEmpty)
              e.key: [for (final a in e.value) if (_allowed('${e.key}:$a')) a],
      };

  void _toggleRow(String resource, bool on) {
    setState(() {
      for (final a in _matrix[resource]!) {
        on ? _perms.add('$resource:$a') : _perms.remove('$resource:$a');
      }
    });
  }

  Future<void> _save() async {
    final api = apiOf(context);
    await saveAndClose(context, (v) => setState(() => _busy = v), () async {
      final body = {
        'name': _name.text.trim(),
        'description': _desc.text.trim(),
        'kind': _kind,
        'permissions': [
          for (final p in _perms)
            if (_allowed(p) && !_superAdminOnly.contains(p.split(':').first)) p,
        ],
      };
      widget.existing == null ? await api.post('/roles', body) : await api.put('/roles/${e['id']}', body);
    }, widget.existing == null ? 'Role created' : 'Access updated');
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(editing ? e['name'].toString() : 'New role')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_system)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Callout(text: 'Built-in role: the name and app type stay the same, but you can change its permissions.'),
          ),
        if (!_system) ...[
          Field(_name, 'Role name', required: true, hint: 'e.g. Store keeper'),
          Field(_desc, 'Description', lines: 2),
          Pick<String>(
            label: 'Which app do they use?',
            value: _kind,
            items: const [('ADMIN', 'Manager app (dashboard, all modules)'), ('WORKER', 'Worker app (tasks, scan, report)')],
            onChanged: (v) => setState(() {
              _kind = v ?? _kind;
              _perms.removeWhere((p) => !_allowed(p));
            }),
          ),
        ],
        Row(children: [
          const Expanded(child: SectionTitle('Permissions')),
          TextButton(
            onPressed: () => setState(() {
              for (final r in _matrix.keys) {
                for (final a in _matrix[r]!) {
                  _perms.add('$r:$a');
                }
              }
            }),
            child: const Text('All'),
          ),
          TextButton(onPressed: () => setState(_perms.clear), child: const Text('None')),
        ]),
        for (final entry in _matrix.entries)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(
                    child: Text(_resourceNames[entry.key] ?? entry.key,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                  Switch(
                    value: entry.value.every((a) => _perms.contains('${entry.key}:$a')),
                    onChanged: (v) => _toggleRow(entry.key, v),
                  ),
                ]),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final a in entry.value)
                    FilterChip(
                      label: Text(_actionNames[a] ?? a),
                      selected: _perms.contains('${entry.key}:$a'),
                      onSelected: (v) => setState(() {
                        final key = '${entry.key}:$a';
                        v ? _perms.add(key) : _perms.remove(key);
                        // Doing anything needs seeing it first.
                        if (v && a != 'view') _perms.add('${entry.key}:view');
                      }),
                    ),
                ]),
              ]),
            ),
          ),
        SaveButton(busy: _busy, text: editing ? 'Save access' : 'Create role', onPressed: _save),
        if (editing && !_system && canManage(context, 'roles:delete'))
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: () async {
              if (!await confirm(context, 'Delete this role?', body: 'Only possible when nobody has it.', action: 'Delete')) return;
              if (!context.mounted) return;
              if (await runAction(context, () => api.delete('/roles/${e['id']}'), success: 'Role deleted') && context.mounted) {
                Navigator.of(context).pop(true);
              }
            },
            icon: const Icon(Icons.delete_outline),
            label: const Text('Delete role'),
          ),
      ]),
    );
  }
}
