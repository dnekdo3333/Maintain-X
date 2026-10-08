import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/forms.dart';

/*
 * Add / edit screens for the admin app. Only Super Admin and managers (Admin
 * role) reach them: every entry point checks `canManage`, and the API checks
 * the same permissions again.
 */

/// True for Super Admin and Admin-kind roles holding the permission.
bool canManage(BuildContext context, String permission) {
  final s = context.read<Session>();
  return s.isAdmin && s.can(permission);
}

Future<bool> openEditor(BuildContext context, Widget screen) async =>
    await Navigator.of(context).push<bool>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => screen)) == true;

const kLocationTypes = [
  'KITCHEN', 'HOT_KITCHEN', 'COLD_KITCHEN', 'PREPARATION', 'DISHWASHING', 'DINING', 'STORAGE',
  'BAR', 'UTILITY', 'OFFICE', 'BUILDING', 'FLOOR', 'AREA', 'ROOM', 'OTHER',
];
const kVendorCategories = [
  'REFRIGERATION', 'AC', 'ELECTRICAL', 'PLUMBING', 'GAS', 'FIRE_SAFETY', 'KITCHEN_EQUIPMENT', 'PEST_CONTROL', 'OTHER',
];
const kDocTypes = ['LICENSE', 'CERTIFICATE', 'AMC', 'CONTRACT', 'MANUAL', 'WARRANTY', 'INVOICE', 'SERVICE', 'OTHER'];
const kCriticality = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

Future<List> _list(ApiClient api, String path, [Map<String, dynamic>? q]) async {
  final r = await api.get(path, q);
  return (r as Map)['data'] as List;
}

List<(String?, String)> _restaurantOptions(BuildContext context) => [
      for (final r in context.read<Session>().restaurants) (r['id'].toString(), r['name'].toString()),
    ];

/// Loads lookup lists once for a form.
mixin _Lookups<T extends StatefulWidget> on State<T> {
  ApiClient get api => apiOf(context);
  bool busy = false;
  void setBusy(bool v) => setState(() => busy = v);
}

// ================================================================ restaurants

class RestaurantForm extends StatefulWidget {
  const RestaurantForm({super.key, this.existing});
  final Json? existing;
  @override
  State<RestaurantForm> createState() => _RestaurantFormState();
}

class _RestaurantFormState extends State<RestaurantForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _code = TextEditingController(text: e['code'] ?? '');
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _a1 = TextEditingController(text: e['addressLine1'] ?? '');
  late final _a2 = TextEditingController(text: e['addressLine2'] ?? '');
  late final _city = TextEditingController(text: e['city'] ?? '');
  late final _state = TextEditingController(text: e['state'] ?? 'Gujarat');
  late final _pin = TextEditingController(text: e['postalCode'] ?? '');
  late final _phone = TextEditingController(text: e['phone'] ?? '');
  late final _email = TextEditingController(text: e['email'] ?? '');
  late final _contact = TextEditingController(text: e['contactName'] ?? '');
  late String _opens = e['opensAt'] ?? '08:00';
  late String _closes = e['closesAt'] ?? '23:00';
  late String _status = e['status'] ?? 'ACTIVE';
  late String? _managerId = (e['manager'] as Map?)?['id'];
  List _users = const [];

  @override
  void initState() {
    super.initState();
    _list(api, '/users', {'pageSize': 100, 'status': 'ACTIVE'}).then((u) {
      if (mounted) setState(() => _users = u);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit restaurant' : 'Add restaurant')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, 'Restaurant name', required: true, hint: 'Bookends Café – Satellite'),
        Field(_code, 'Code', required: true, hint: 'BKD-SAT', helper: 'Capital letters, numbers and -, up to 12'),
        Field(_a1, 'Address line 1'),
        Field(_a2, 'Address line 2'),
        Row(children: [
          Expanded(child: Field(_city, 'City')),
          const SizedBox(width: 12),
          Expanded(child: Field(_pin, 'PIN code', keyboard: TextInputType.number)),
        ]),
        Field(_state, 'State'),
        Field(_phone, 'Phone', keyboard: TextInputType.phone, hint: '+917926400000'),
        Field(_email, 'Email', keyboard: TextInputType.emailAddress),
        Row(children: [
          Expanded(child: TimeField(label: 'Opens at', value: _opens, onChanged: (v) => setState(() => _opens = v))),
          const SizedBox(width: 12),
          Expanded(child: TimeField(label: 'Closes at', value: _closes, onChanged: (v) => setState(() => _closes = v))),
        ]),
        Pick<String>(
          label: 'Manager',
          value: _managerId,
          items: [(null, 'None'), for (final u in _users) ((u as Map)['id'].toString(), '${personName(u)} · ${(u['role'] as Map?)?['name'] ?? ''}')],
          onChanged: (v) => setState(() => _managerId = v),
        ),
        Field(_contact, 'Contact person'),
        Pick<String>(
          label: 'Status',
          value: _status,
          items: const [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')],
          onChanged: (v) => setState(() => _status = v ?? 'ACTIVE'),
        ),
        SaveButton(
          busy: busy,
          text: editing ? 'Save changes' : 'Add restaurant',
          onPressed: () => saveAndClose(context, setBusy, () async {
            final body = {
              'code': _code.text.trim().toUpperCase(),
              'name': _name.text.trim(),
              'addressLine1': _a1.text.trim(),
              'addressLine2': _a2.text.trim(),
              'city': _city.text.trim(),
              'state': _state.text.trim(),
              'postalCode': _pin.text.trim(),
              'phone': _phone.text.trim(),
              'email': _email.text.trim(),
              'opensAt': _opens,
              'closesAt': _closes,
              'status': _status,
              'managerId': _managerId ?? '',
              'contactName': _contact.text.trim(),
            };
            editing ? await api.put('/restaurants/${e['id']}', body) : await api.post('/restaurants', body);
            if (context.mounted) await context.read<Session>().reloadUser();
          }, editing ? 'Restaurant updated' : 'Restaurant added'),
        ),
      ]),
    );
  }
}

/// One restaurant: details, its locations (add / edit / remove) and actions.
class RestaurantDetailScreen extends StatefulWidget {
  const RestaurantDetailScreen({super.key, required this.id});
  final String id;
  @override
  State<RestaurantDetailScreen> createState() => _RestaurantDetailScreenState();
}

class _RestaurantDetailScreenState extends State<RestaurantDetailScreen> {
  final _key = GlobalKey<DataViewState<(Json, List)>>();

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final canEdit = canManage(context, 'restaurants:edit');
    final canLoc = canManage(context, 'locations:create');
    return Scaffold(
      appBar: AppBar(title: const Text('Restaurant')),
      body: DataView<(Json, List)>(
        key: _key,
        load: () async => (
          await api.getData<Json>('/restaurants/${widget.id}'),
          await api.getData<List>('/locations', {'restaurantId': widget.id}),
        ),
        builder: (context, d, reload) {
          final r = d.$1;
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const IconChip(Icons.storefront_outlined, brand: true, size: 46),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(r['name'].toString(), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                      Text(r['code'].toString(), style: const TextStyle(color: AppColors.muted)),
                    ]),
                  ),
                  StatusBadge(r['status']?.toString()),
                ]),
                const SizedBox(height: 10),
                InfoRow('Address', [r['addressLine1'], r['addressLine2'], r['city'], r['state'], r['postalCode']].whereType<String>().where((x) => x.isNotEmpty).join(', ')),
                InfoRow('Phone', r['phone']?.toString()),
                InfoRow('Email', r['email']?.toString()),
                InfoRow('Hours', r['opensAt'] == null ? null : '${r['opensAt']} – ${r['closesAt']}'),
                InfoRow('Manager', r['manager'] == null ? null : personName(r['manager'])),
                InfoRow('Contact', r['contactName']?.toString()),
              ]),
            ),
            if (canEdit) ...[
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      if (await openEditor(context, RestaurantForm(existing: r))) reload();
                    },
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Edit'),
                  ),
                ),
                if (canManage(context, 'restaurants:delete')) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
                      onPressed: () async {
                        if (!await confirm(context, 'Archive this restaurant?',
                            body: 'It will be hidden from lists. History is kept.', action: 'Archive')) {
                          return;
                        }
                        if (!context.mounted) return;
                        if (await runAction(context, () => api.delete('/restaurants/${r['id']}'), success: 'Archived') &&
                            context.mounted) {
                          await context.read<Session>().reloadUser();
                          if (context.mounted) Navigator.of(context).pop(true);
                        }
                      },
                      icon: const Icon(Icons.archive_outlined),
                      label: const Text('Archive'),
                    ),
                  ),
                ],
              ]),
            ],
            const SizedBox(height: 18),
            SectionTitle('Locations (${d.$2.length})',
                trailing: canLoc
                    ? TextButton.icon(
                        onPressed: () async {
                          if (await openEditor(context, LocationForm(restaurantId: widget.id))) reload();
                        },
                        icon: const Icon(Icons.add),
                        label: const Text('Add location'),
                      )
                    : null),
            if (d.$2.isEmpty) const Text('No locations yet.', style: TextStyle(color: AppColors.muted)),
            for (final l in d.$2)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppCard(
                  onTap: canManage(context, 'locations:edit')
                      ? () async {
                          if (await openEditor(context, LocationForm(restaurantId: widget.id, existing: (l as Map).cast<String, dynamic>()))) {
                            reload();
                          }
                        }
                      : null,
                  child: Row(children: [
                    const IconChip(Icons.place_outlined, size: 36),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text((l as Map)['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text('${label(l['type'])} · ${l['assetCount'] ?? 0} assets',
                            style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                      ]),
                    ),
                    if (canManage(context, 'locations:edit')) const Icon(Icons.edit_outlined, size: 18, color: AppColors.muted),
                  ]),
                ),
              ),
          ]);
        },
      ),
    );
  }
}

class LocationForm extends StatefulWidget {
  const LocationForm({super.key, required this.restaurantId, this.existing});
  final String restaurantId;
  final Json? existing;
  @override
  State<LocationForm> createState() => _LocationFormState();
}

class _LocationFormState extends State<LocationForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _desc = TextEditingController(text: e['description'] ?? '');
  late String _type = e['type'] ?? 'KITCHEN';

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit location' : 'Add location')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, 'Name', required: true, hint: 'e.g. Tandoor Section'),
        Pick<String>(
          label: 'Type',
          value: _type,
          items: [for (final t in kLocationTypes) (t, label(t))],
          onChanged: (v) => setState(() => _type = v ?? _type),
        ),
        Field(_desc, 'Description', lines: 2),
        SaveButton(
          busy: busy,
          onPressed: () => saveAndClose(context, setBusy, () async {
            final body = {
              'restaurantId': widget.restaurantId,
              'name': _name.text.trim(),
              'type': _type,
              'description': _desc.text.trim(),
            };
            editing ? await api.put('/locations/${e['id']}', body) : await api.post('/locations', body);
          }, editing ? 'Location updated' : 'Location added'),
        ),
        if (editing && canManage(context, 'locations:delete'))
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: () async {
              if (!await confirm(context, 'Remove this location?', action: 'Remove')) return;
              if (!context.mounted) return;
              if (await runAction(context, () => api.delete('/locations/${e['id']}'), success: 'Removed') && context.mounted) {
                Navigator.of(context).pop(true);
              }
            },
            icon: const Icon(Icons.delete_outline),
            label: const Text('Remove location'),
          ),
      ]),
    );
  }
}

// ================================================================ assets

class AssetForm extends StatefulWidget {
  const AssetForm({super.key, this.existing});
  final Json? existing;
  @override
  State<AssetForm> createState() => _AssetFormState();
}

class _AssetFormState extends State<AssetForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _mfr = TextEditingController(text: e['manufacturer'] ?? '');
  late final _model = TextEditingController(text: e['model'] ?? '');
  late final _serial = TextEditingController(text: e['serialNumber'] ?? '');
  late final _cost = TextEditingController(text: numText(e['purchaseCost']));
  late final _notes = TextEditingController(text: e['notes'] ?? '');
  late String? _categoryId = (e['category'] as Map?)?['id'];
  late String? _restaurantId = (e['restaurant'] as Map?)?['id'];
  late String? _locationId = (e['location'] as Map?)?['id'];
  late String? _vendorId = (e['vendor'] as Map?)?['id'];
  late String _criticality = e['criticality'] ?? 'MEDIUM';
  late String _install = dateText(e['installDate']);
  late String _purchase = dateText(e['purchaseDate']);
  late String _wStart = dateText(e['warrantyStart']);
  late String _wEnd = dateText(e['warrantyEnd']);
  List _categories = const [], _locations = const [], _vendors = const [];

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId ??= rs.isNotEmpty ? rs.first['id'].toString() : null;
    _loadLookups();
    _loadLocations();
  }

  Future<void> _loadLookups() async {
    try {
      final c = await api.getData<List>('/asset-categories');
      final v = await _list(api, '/vendors', {'pageSize': 100});
      if (mounted) {
        setState(() {
          _categories = c;
          _vendors = v;
        });
      }
    } catch (_) {}
  }

  Future<void> _loadLocations() async {
    if (_restaurantId == null) return;
    try {
      final l = await api.getData<List>('/locations', {'restaurantId': _restaurantId});
      if (mounted) setState(() => _locations = l);
    } catch (_) {}
  }

  Future<void> _newCategory() async {
    final name = await askText(context, title: 'New category', hint: 'e.g. Tandoor', action: 'Add', minLength: 2);
    if (name == null || !mounted) return;
    try {
      final c = await api.postData<Json>('/asset-categories', {'name': name});
      await _loadLookups();
      setState(() => _categoryId = c['id'].toString());
    } catch (err) {
      if (mounted) toast(context, errorText(err), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit asset' : 'Add asset')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, 'Asset name', required: true, hint: 'e.g. Walk-in Freezer'),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Pick<String>(
              label: 'Category',
              required: true,
              value: _categoryId,
              items: [for (final c in _categories) ((c as Map)['id'].toString(), c['name'].toString())],
              onChanged: (v) => setState(() => _categoryId = v),
            ),
          ),
          IconButton(tooltip: 'New category', onPressed: _newCategory, icon: const Icon(Icons.add_circle_outline, color: AppColors.primary)),
        ]),
        Pick<String>(
          label: 'Restaurant',
          required: true,
          value: _restaurantId,
          items: _restaurantOptions(context),
          onChanged: (v) {
            setState(() {
              _restaurantId = v;
              _locationId = null;
              _locations = const [];
            });
            _loadLocations();
          },
        ),
        Pick<String>(
          label: 'Location',
          value: _locationId,
          items: [(null, 'None'), for (final l in _locations) ((l as Map)['id'].toString(), l['name'].toString())],
          onChanged: (v) => setState(() => _locationId = v),
        ),
        Pick<String>(
          label: 'Criticality',
          value: _criticality,
          items: [for (final c in kCriticality) (c, label(c))],
          onChanged: (v) => setState(() => _criticality = v ?? _criticality),
        ),
        Field(_mfr, 'Manufacturer'),
        Row(children: [
          Expanded(child: Field(_model, 'Model')),
          const SizedBox(width: 12),
          Expanded(child: Field(_serial, 'Serial no.')),
        ]),
        Pick<String>(
          label: 'Service vendor',
          value: _vendorId,
          items: [(null, 'None'), for (final v in _vendors) ((v as Map)['id'].toString(), v['name'].toString())],
          onChanged: (v) => setState(() => _vendorId = v),
        ),
        DateField(label: 'Install date', value: _install, onChanged: (v) => setState(() => _install = v)),
        DateField(label: 'Purchase date', value: _purchase, onChanged: (v) => setState(() => _purchase = v)),
        Field(_cost, 'Purchase cost (₹)', keyboard: const TextInputType.numberWithOptions(decimal: true)),
        DateField(label: 'Warranty start', value: _wStart, onChanged: (v) => setState(() => _wStart = v)),
        DateField(label: 'Warranty end', value: _wEnd, onChanged: (v) => setState(() => _wEnd = v)),
        Field(_notes, 'Notes', lines: 3),
        SaveButton(
          busy: busy,
          text: editing ? 'Save changes' : 'Add asset',
          onPressed: () {
            if (_categoryId == null || _restaurantId == null) {
              toast(context, 'Category aur restaurant select karein', error: true);
              return;
            }
            saveAndClose(context, setBusy, () async {
              final body = {
                'name': _name.text.trim(),
                'categoryId': _categoryId,
                'restaurantId': _restaurantId,
                'locationId': _locationId ?? '',
                'criticality': _criticality,
                'installDate': _install,
                'manufacturer': _mfr.text.trim(),
                'model': _model.text.trim(),
                'serialNumber': _serial.text.trim(),
                'purchaseDate': _purchase,
                'purchaseCost': _cost.text.trim(),
                'warrantyStart': _wStart,
                'warrantyEnd': _wEnd,
                'notes': _notes.text.trim(),
                'vendorId': _vendorId ?? '',
              };
              editing ? await api.put('/assets/${e['id']}', body) : await api.post('/assets', body);
            }, editing ? 'Asset updated' : 'Asset added');
          },
        ),
      ]),
    );
  }
}

/// Edit / status / archive actions shown on the asset screen for managers.
class AssetAdminActions extends StatelessWidget {
  const AssetAdminActions({super.key, required this.asset, required this.onChanged});
  final Json asset;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    if (!canManage(context, 'assets:edit')) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () async {
              if (await openEditor(context, AssetForm(existing: asset))) onChanged();
            },
            icon: const Icon(Icons.edit_outlined),
            label: const Text('Edit'),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () async {
              final status = await pickOption<String>(context, 'Change status', [
                for (final s in const ['OPERATIONAL', 'WARNING', 'UNDER_MAINTENANCE', 'BROKEN', 'INACTIVE', 'RETIRED']) (s, label(s)),
              ]);
              if (status == null || !context.mounted) return;
              final note = await askText(context, title: 'Note (optional)', action: 'Save');
              if (note == null || !context.mounted) return;
              if (await runAction(context, () => api.put('/assets/${asset['id']}/status', {'status': status, 'note': note}),
                  success: 'Status updated')) {
                onChanged();
              }
            },
            icon: const Icon(Icons.sync_alt),
            label: const Text('Status'),
          ),
        ),
        if (canManage(context, 'assets:delete')) ...[
          const SizedBox(width: 10),
          IconButton.outlined(
            color: AppColors.dangerFg,
            onPressed: () async {
              if (!await confirm(context, 'Archive this asset?', action: 'Archive')) return;
              if (!context.mounted) return;
              if (await runAction(context, () => api.delete('/assets/${asset['id']}'), success: 'Archived') && context.mounted) {
                Navigator.of(context).pop(true);
              }
            },
            icon: const Icon(Icons.archive_outlined),
          ),
        ],
      ]),
    );
  }
}

// ================================================================ parts & stock

class PartForm extends StatefulWidget {
  const PartForm({super.key, this.existing});
  final Json? existing;
  @override
  State<PartForm> createState() => _PartFormState();
}

class _PartFormState extends State<PartForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _no = TextEditingController(text: e['partNumber'] ?? '');
  late final _sku = TextEditingController(text: e['sku'] ?? '');
  late final _cat = TextEditingController(text: e['category'] ?? '');
  late final _unit = TextEditingController(text: e['unit'] ?? 'pcs');
  late final _cost = TextEditingController(text: numText(e['unitCost']));
  late final _min = TextEditingController(text: numText(e['minStock'] ?? 0));
  late final _reorder = TextEditingController(text: numText(e['reorderQty']));
  late final _store = TextEditingController(text: e['storageLocation'] ?? '');
  late final _desc = TextEditingController(text: e['description'] ?? '');
  late String? _vendorId = (e['preferredVendor'] as Map?)?['id'];
  List _vendors = const [];

  @override
  void initState() {
    super.initState();
    _list(api, '/vendors', {'pageSize': 100}).then((v) {
      if (mounted) setState(() => _vendors = v);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    const dec = TextInputType.numberWithOptions(decimal: true);
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit part' : 'Add part')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, 'Part name', required: true, hint: 'e.g. Door gasket 2 m'),
        Row(children: [
          Expanded(child: Field(_no, 'Part number', required: true, hint: 'GSK-2M')),
          const SizedBox(width: 12),
          Expanded(child: Field(_sku, 'SKU / barcode')),
        ]),
        Row(children: [
          Expanded(child: Field(_cat, 'Category', hint: 'Refrigeration')),
          const SizedBox(width: 12),
          Expanded(child: Field(_unit, 'Unit', required: true, hint: 'pcs, kg, m')),
        ]),
        Row(children: [
          Expanded(child: Field(_cost, 'Unit cost (₹)', required: true, keyboard: dec)),
          const SizedBox(width: 12),
          Expanded(child: Field(_min, 'Minimum stock', keyboard: dec)),
        ]),
        Field(_reorder, 'Reorder quantity', keyboard: dec, helper: 'Empty = twice the minimum'),
        Pick<String>(
          label: 'Preferred vendor',
          value: _vendorId,
          items: [(null, 'None'), for (final v in _vendors) ((v as Map)['id'].toString(), v['name'].toString())],
          onChanged: (v) => setState(() => _vendorId = v),
        ),
        Field(_store, 'Storage location', hint: 'Rack A-1'),
        Field(_desc, 'Description', lines: 2),
        SaveButton(
          busy: busy,
          text: editing ? 'Save changes' : 'Add part',
          onPressed: () => saveAndClose(context, setBusy, () async {
            final reorder = num.tryParse(_reorder.text.trim());
            final body = {
              'name': _name.text.trim(),
              'partNumber': _no.text.trim(),
              'sku': _sku.text.trim(),
              'category': _cat.text.trim(),
              'unit': _unit.text.trim(),
              'unitCost': num.tryParse(_cost.text.trim()) ?? 0,
              'minStock': num.tryParse(_min.text.trim()) ?? 0,
              'reorderQty': ?reorder,
              'preferredVendorId': _vendorId ?? '',
              'storageLocation': _store.text.trim(),
              'description': _desc.text.trim(),
            };
            editing ? await api.put('/parts/${e['id']}', body) : await api.post('/parts', body);
          }, editing ? 'Part updated' : 'Part added'),
        ),
      ]),
    );
  }
}

class PartDetailScreen extends StatefulWidget {
  const PartDetailScreen({super.key, required this.id});
  final String id;
  @override
  State<PartDetailScreen> createState() => _PartDetailScreenState();
}

class _PartDetailScreenState extends State<PartDetailScreen> {
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Part')),
      body: DataView<Json>(
        load: () => api.getData<Json>('/parts/${widget.id}'),
        builder: (context, p, reload) {
          final can = (p['can'] as Map?) ?? const {};
          final levels = (p['stockLevels'] as List?) ?? const [];
          final txns = (p['transactions'] as List?) ?? const [];
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(p['name'].toString(), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                Text('${p['partNumber']} · ${p['category'] ?? ''}', style: const TextStyle(color: AppColors.muted)),
                const SizedBox(height: 8),
                InfoRow('Unit cost', '${fmtMoney(p['unitCost'])} / ${p['unit']}'),
                InfoRow('Total in stock', '${p['totalQuantity']} ${p['unit']}'),
                InfoRow('Minimum', '${p['minStock']}'),
                InfoRow('Vendor', (p['preferredVendor'] as Map?)?['name']?.toString()),
                InfoRow('Storage', p['storageLocation']?.toString()),
              ]),
            ),
            if (isManager(context)) ...[
              const SizedBox(height: 10),
              Row(children: [
                if (can['adjust'] == true)
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () async {
                        if (await openEditor(context, StockAdjustForm(part: p))) reload();
                      },
                      icon: const Icon(Icons.swap_vert),
                      label: const Text('Stock in / out'),
                    ),
                  ),
                if (can['edit'] == true) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        if (await openEditor(context, PartForm(existing: p))) reload();
                      },
                      icon: const Icon(Icons.edit_outlined),
                      label: const Text('Edit'),
                    ),
                  ),
                ],
                if (can['delete'] == true) ...[
                  const SizedBox(width: 10),
                  IconButton.outlined(
                    color: AppColors.dangerFg,
                    onPressed: () async {
                      if (!await confirm(context, 'Archive this part?', action: 'Archive')) return;
                      if (!context.mounted) return;
                      if (await runAction(context, () => api.delete('/parts/${p['id']}'), success: 'Archived') && context.mounted) {
                        Navigator.of(context).pop(true);
                      }
                    },
                    icon: const Icon(Icons.archive_outlined),
                  ),
                ],
              ]),
            ],
            const SizedBox(height: 18),
            const SectionTitle('Stock by restaurant'),
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (final l in levels)
                  ListTile(
                    title: Text(((l as Map)['restaurant'] as Map)['name'].toString()),
                    subtitle: Text('Min ${l['minStock']} · ${l['storageLocation'] ?? ''}${(l['reserved'] ?? 0) > 0 ? ' · ${l['reserved']} reserved' : ''}'),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text('${l['quantity']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                      if (l['low'] == true) ...[const SizedBox(width: 6), const Pill('Low', tone: 'warning')],
                    ]),
                  ),
              ]),
            ),
            if (txns.isNotEmpty) ...[
              const SizedBox(height: 18),
              const SectionTitle('Recent movements'),
              AppCard(
                padding: EdgeInsets.zero,
                child: Column(children: [
                  for (final t in txns.take(20))
                    ListTile(
                      dense: true,
                      leading: Icon(((t as Map)['quantityDelta'] as num) >= 0 ? Icons.south_west : Icons.north_east,
                          color: (t['quantityDelta'] as num) >= 0 ? AppColors.success : AppColors.danger),
                      title: Text('${label(t['type'])} ${t['quantityDelta']} → ${t['balanceAfter']}'),
                      subtitle: Text('${(t['restaurant'] as Map?)?['name'] ?? ''} · ${t['reason'] ?? ''}\n${personName(t['actor'])} · ${fmtDateTime(t['createdAt'])}'),
                      isThreeLine: true,
                    ),
                ]),
              ),
            ],
          ]);
        },
      ),
    );
  }
}

bool isManager(BuildContext context) => context.read<Session>().isAdmin;

class StockAdjustForm extends StatefulWidget {
  const StockAdjustForm({super.key, required this.part});
  final Json part;
  @override
  State<StockAdjustForm> createState() => _StockAdjustFormState();
}

class _StockAdjustFormState extends State<StockAdjustForm> with _Lookups {
  static const _modes = [
    ('RECEIVE', 'Received (stock in)'),
    ('ISSUE', 'Issued to a person'),
    ('RETURN', 'Returned'),
    ('DAMAGED', 'Damaged'),
    ('REMOVE', 'Removed / lost'),
    ('COUNT', 'Set counted quantity'),
  ];
  String _mode = 'RECEIVE';
  String? _restaurantId;
  String? _issuedTo;
  final _qty = TextEditingController();
  final _cost = TextEditingController();
  final _reason = TextEditingController();
  List _people = const [];

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId = rs.isNotEmpty ? rs.first['id'].toString() : null;
    _loadPeople();
  }

  Future<void> _loadPeople() async {
    if (_restaurantId == null) return;
    try {
      final p = await api.getData<List>('/work-orders/workload', {'restaurantId': _restaurantId});
      if (mounted) setState(() => _people = p);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.part['name'].toString())),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Pick<String>(
          label: 'Restaurant',
          required: true,
          value: _restaurantId,
          items: _restaurantOptions(context),
          onChanged: (v) {
            setState(() => _restaurantId = v);
            _loadPeople();
          },
        ),
        Pick<String>(
          label: 'What happened?',
          value: _mode,
          items: [for (final m in _modes) (m.$1, m.$2)],
          onChanged: (v) => setState(() => _mode = v ?? _mode),
        ),
        Field(_qty, _mode == 'COUNT' ? 'Counted quantity' : 'Quantity', required: true,
            keyboard: const TextInputType.numberWithOptions(decimal: true)),
        if (_mode == 'RECEIVE')
          Field(_cost, 'Unit cost (₹)', keyboard: const TextInputType.numberWithOptions(decimal: true)),
        if (_mode == 'ISSUE')
          Pick<String>(
            label: 'Issued to',
            required: true,
            value: _issuedTo,
            items: [for (final p in _people) (((p as Map)['user'] as Map)['id'].toString(), personName(p['user']))],
            onChanged: (v) => setState(() => _issuedTo = v),
          ),
        Field(_reason, 'Reason', required: true, hint: 'e.g. New stock from vendor'),
        SaveButton(
          busy: busy,
          onPressed: () => saveAndClose(context, setBusy, () async {
            final cost = num.tryParse(_cost.text.trim());
            await api.post('/parts/${widget.part['id']}/adjust', {
              'restaurantId': _restaurantId,
              'mode': _mode,
              'quantity': num.tryParse(_qty.text.trim()) ?? 0,
              if (_mode == 'RECEIVE' && cost != null) 'unitCost': cost,
              if (_mode == 'ISSUE') 'issuedToId': _issuedTo ?? '',
              'reason': _reason.text.trim(),
            });
          }, 'Stock updated'),
        ),
      ]),
    );
  }
}

// ================================================================ vendors

class VendorForm extends StatefulWidget {
  const VendorForm({super.key, this.existing});
  final Json? existing;
  @override
  State<VendorForm> createState() => _VendorFormState();
}

class _VendorFormState extends State<VendorForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _contact = TextEditingController(text: e['contactName'] ?? '');
  late final _email = TextEditingController(text: e['email'] ?? '');
  late final _phone = TextEditingController(text: e['phone'] ?? '');
  late final _alt = TextEditingController(text: e['altPhone'] ?? '');
  late final _address = TextEditingController(text: e['address'] ?? '');
  late final _city = TextEditingController(text: e['city'] ?? '');
  late final _tax = TextEditingController(text: e['taxId'] ?? '');
  late final _notes = TextEditingController(text: e['notes'] ?? '');
  late Set<String> _cats = {for (final c in (e['categories'] as List? ?? const [])) c.toString()};
  late Set<String> _restaurants = {for (final r in (e['restaurants'] as List? ?? const [])) (r as Map)['id'].toString()};

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    final s = context.read<Session>();
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit vendor' : 'Add vendor')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, 'Vendor name', required: true),
        Field(_contact, 'Contact person'),
        Row(children: [
          Expanded(child: Field(_phone, 'Phone', keyboard: TextInputType.phone)),
          const SizedBox(width: 12),
          Expanded(child: Field(_alt, 'Alternate phone', keyboard: TextInputType.phone)),
        ]),
        Field(_email, 'Email', keyboard: TextInputType.emailAddress),
        Field(_address, 'Address', lines: 2),
        Row(children: [
          Expanded(child: Field(_city, 'City')),
          const SizedBox(width: 12),
          Expanded(child: Field(_tax, 'GSTIN')),
        ]),
        MultiPick(
          label: 'Services',
          options: [for (final c in kVendorCategories) (c, label(c))],
          selected: _cats,
          onChanged: (v) => setState(() => _cats = v),
        ),
        MultiPick(
          label: 'Restaurants served',
          emptyText: s.isSuperAdmin ? 'All restaurants' : 'All my restaurants',
          options: [for (final r in context.read<Session>().restaurants) (r['id'].toString(), r['name'].toString())],
          selected: _restaurants,
          onChanged: (v) => setState(() => _restaurants = v),
        ),
        Field(_notes, 'Notes', lines: 3),
        SaveButton(
          busy: busy,
          text: editing ? 'Save changes' : 'Add vendor',
          onPressed: () => saveAndClose(context, setBusy, () async {
            final body = {
              'name': _name.text.trim(),
              'contactName': _contact.text.trim(),
              'email': _email.text.trim(),
              'phone': _phone.text.trim(),
              'altPhone': _alt.text.trim(),
              'address': _address.text.trim(),
              'city': _city.text.trim(),
              'categories': _cats.toList(),
              'taxId': _tax.text.trim(),
              'notes': _notes.text.trim(),
              // "All" (empty) is Super Admin only; a manager's "all" means all of their restaurants.
              'restaurantIds': _restaurants.isEmpty && !s.isSuperAdmin
                  ? [for (final r in s.restaurants) r['id'].toString()]
                  : _restaurants.toList(),
            };
            editing ? await api.put('/vendors/${e['id']}', body) : await api.post('/vendors', body);
          }, editing ? 'Vendor updated' : 'Vendor added'),
        ),
        if (editing && canManage(context, 'vendors:delete'))
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: () async {
              if (!await confirm(context, 'Archive this vendor?', action: 'Archive')) return;
              if (!context.mounted) return;
              if (await runAction(context, () => api.delete('/vendors/${e['id']}'), success: 'Archived') && context.mounted) {
                Navigator.of(context).pop(true);
              }
            },
            icon: const Icon(Icons.archive_outlined),
            label: const Text('Archive vendor'),
          ),
      ]),
    );
  }
}

// ================================================================ teams

class TeamForm extends StatefulWidget {
  const TeamForm({super.key, this.existing});
  final Json? existing;
  @override
  State<TeamForm> createState() => _TeamFormState();
}

class _TeamFormState extends State<TeamForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _name = TextEditingController(text: e['name'] ?? '');
  late final _desc = TextEditingController(text: e['description'] ?? '');
  late String? _restaurantId = (e['restaurant'] as Map?)?['id'];
  late String? _leadId = (e['lead'] as Map?)?['id'];
  late Set<String> _members = {for (final m in (e['members'] as List? ?? const [])) (m as Map)['id'].toString()};
  List _users = const [];

  @override
  void initState() {
    super.initState();
    _list(api, '/users', {'pageSize': 100, 'status': 'ACTIVE'}).then((u) {
      if (mounted) setState(() => _users = u);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    final s = context.read<Session>();
    final people = [for (final u in _users) ((u as Map)['id'].toString(), '${personName(u)} · ${(u['role'] as Map?)?['name'] ?? ''}')];
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit team' : 'Add team')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_name, 'Team name', required: true, hint: 'e.g. Night shift maintenance'),
        Field(_desc, 'Description', lines: 2),
        Pick<String>(
          label: 'Restaurant',
          value: _restaurantId,
          items: [if (s.isSuperAdmin) (null, 'All restaurants'), ..._restaurantOptions(context)],
          onChanged: (v) => setState(() => _restaurantId = v),
        ),
        MultiPick(label: 'Members', options: people, selected: _members, onChanged: (v) => setState(() => _members = v)),
        Pick<String>(
          label: 'Team lead',
          value: _leadId,
          items: [(null, 'None'), for (final p in people) if (_members.contains(p.$1)) (p.$1, p.$2)],
          onChanged: (v) => setState(() => _leadId = v),
        ),
        SaveButton(
          busy: busy,
          text: editing ? 'Save changes' : 'Add team',
          onPressed: () {
            if (!s.isSuperAdmin && _restaurantId == null) {
              toast(context, 'Restaurant select karein', error: true);
              return;
            }
            saveAndClose(context, setBusy, () async {
              final body = {
                'name': _name.text.trim(),
                'description': _desc.text.trim(),
                'restaurantId': _restaurantId,
                'leadUserId': _leadId != null && _members.contains(_leadId) ? _leadId : null,
                'memberIds': _members.toList(),
              };
              editing ? await api.put('/teams/${e['id']}', body) : await api.post('/teams', body);
            }, editing ? 'Team updated' : 'Team added');
          },
        ),
        if (editing && canManage(context, 'teams:delete'))
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppColors.dangerFg),
            onPressed: () async {
              if (!await confirm(context, 'Archive this team?', action: 'Archive')) return;
              if (!context.mounted) return;
              if (await runAction(context, () => api.delete('/teams/${e['id']}'), success: 'Archived') && context.mounted) {
                Navigator.of(context).pop(true);
              }
            },
            icon: const Icon(Icons.archive_outlined),
            label: const Text('Archive team'),
          ),
      ]),
    );
  }
}

// ================================================================ users

class UserForm extends StatefulWidget {
  const UserForm({super.key, this.existing});
  final Json? existing;
  @override
  State<UserForm> createState() => _UserFormState();
}

class _UserFormState extends State<UserForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late final _first = TextEditingController(text: e['firstName'] ?? '');
  late final _last = TextEditingController(text: e['lastName'] ?? '');
  late final _email = TextEditingController(text: e['email'] ?? '');
  late final _username = TextEditingController(text: e['username'] ?? '');
  late final _phone = TextEditingController(text: e['phone'] ?? '');
  late final _job = TextEditingController(text: e['jobTitle'] ?? '');
  late final _rate = TextEditingController(text: numText(e['hourlyRate']));
  final _password = TextEditingController();
  late String? _roleId = (e['role'] as Map?)?['id'];
  late Set<String> _restaurants = {for (final r in (e['restaurants'] as List? ?? const [])) (r as Map)['id'].toString()};
  List _roles = const [];

  @override
  void initState() {
    super.initState();
    api.getData<List>('/roles/assignable').then((r) {
      if (mounted) setState(() => _roles = r);
    }).catchError((_) {});
  }

  Future<void> _save() async {
    final editing = widget.existing != null;
    if (_roleId == null) {
      toast(context, 'Role select karein', error: true);
      return;
    }
    final canAssign = canManage(context, 'users:assign');
    setBusy(true);
    try {
      final profile = {
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'email': _email.text.trim(),
        'username': _username.text.trim(),
        'phone': _phone.text.trim(),
        'jobTitle': _job.text.trim(),
        'hourlyRate': _rate.text.trim(),
      };
      String? temp;
      if (editing) {
        await api.put('/users/${e['id']}', profile);
        if (canAssign) {
          await api.put('/users/${e['id']}/access', {'roleId': _roleId, 'restaurantIds': _restaurants.toList()});
        }
      } else {
        final created = await api.postData<Json>('/users', {
          ...profile,
          'roleId': _roleId,
          'restaurantIds': _restaurants.toList(),
          'password': _password.text,
        });
        temp = created['temporaryPassword']?.toString();
      }
      if (!mounted) return;
      if (temp != null && temp.isNotEmpty) {
        await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('User created'),
            content: SelectableText('Temporary password:\n\n$temp\n\nShare it with the user. They must change it at first sign-in.'),
            actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
          ),
        );
      }
      if (!mounted) return;
      toast(context, editing ? 'User updated' : 'User added');
      Navigator.of(context).pop(true);
    } catch (err) {
      if (mounted) toast(context, errorText(err), error: true);
    } finally {
      if (mounted) setBusy(false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    final s = context.read<Session>();
    final roles = [
      for (final r in _roles)
        // Only a Super Admin may create another Super Admin.
        if ((r as Map)['systemKey'] != 'SUPER_ADMIN' || s.isSuperAdmin) (r['id'].toString(), r['name'].toString()),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit user' : 'Add user')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [
          Expanded(child: Field(_first, 'First name', required: true)),
          const SizedBox(width: 12),
          Expanded(child: Field(_last, 'Last name', required: true)),
        ]),
        Field(_username, 'Username', hint: 'e.g. ramesh.patel', helper: 'Email, username or phone — at least one'),
        Field(_phone, 'Mobile', keyboard: TextInputType.phone, hint: '+919800000000'),
        Field(_email, 'Email', keyboard: TextInputType.emailAddress),
        Field(_job, 'Job title', hint: 'e.g. Electrician'),
        Field(_rate, 'Hourly rate (₹)', keyboard: const TextInputType.numberWithOptions(decimal: true)),
        Pick<String>(label: 'Role', required: true, value: _roleId, items: roles, onChanged: (v) => setState(() => _roleId = v)),
        MultiPick(
          label: 'Restaurants',
          options: [for (final r in s.restaurants) (r['id'].toString(), r['name'].toString())],
          selected: _restaurants,
          onChanged: (v) => setState(() => _restaurants = v),
        ),
        if (!editing)
          Field(_password, 'Password', obscure: true,
              helper: 'Empty = a temporary password is generated. 8+ characters with letters and numbers.'),
        SaveButton(busy: busy, text: editing ? 'Save changes' : 'Add user', onPressed: _save),
      ]),
    );
  }
}

class UserDetailScreen extends StatelessWidget {
  const UserDetailScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: const Text('User')),
      body: DataView<Json>(
        load: () => api.getData<Json>('/users/$id'),
        builder: (context, u, reload) {
          final can = (u['can'] as Map?) ?? const {};
          final active = u['status'] == 'ACTIVE';
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Avatar(u, size: 50),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(personName(u), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                      Text('${(u['role'] as Map?)?['name'] ?? ''}${u['jobTitle'] != null ? ' · ${u['jobTitle']}' : ''}',
                          style: const TextStyle(color: AppColors.muted)),
                    ]),
                  ),
                  StatusBadge(u['status']?.toString()),
                ]),
                const SizedBox(height: 10),
                InfoRow('Username', u['username']?.toString()),
                InfoRow('Mobile', u['phone']?.toString()),
                InfoRow('Email', u['email']?.toString()),
                InfoRow('Restaurants', ((u['restaurants'] as List?) ?? const []).map((r) => (r as Map)['name']).join('\n')),
                InfoRow('Teams', ((u['teams'] as List?) ?? const []).map((t) => (t as Map)['name']).join(', ')),
                InfoRow('Last sign-in', fmtDateTime(u['lastLoginAt'])),
              ]),
            ),
            if (isManager(context)) ...[
              const SizedBox(height: 12),
              if (can['edit'] == true)
                OutlinedButton.icon(
                  onPressed: () async {
                    if (await openEditor(context, UserForm(existing: u))) reload();
                  },
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Edit user'),
                ),
              if (can['resetPassword'] == true) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () async {
                    if (!await confirm(context, 'Reset password?', body: 'A new temporary password will be created.', action: 'Reset')) {
                      return;
                    }
                    try {
                      final r = await api.postData<Json>('/users/${u['id']}/reset-password');
                      if (!context.mounted) return;
                      await showDialog<void>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('New temporary password'),
                          content: SelectableText(r['temporaryPassword'].toString()),
                          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
                        ),
                      );
                    } catch (err) {
                      if (context.mounted) toast(context, errorText(err), error: true);
                    }
                  },
                  icon: const Icon(Icons.key_outlined),
                  label: const Text('Reset password'),
                ),
              ],
              if (can['changeStatus'] == true) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: active ? AppColors.dangerFg : AppColors.successFg),
                  onPressed: () async {
                    if (await runAction(context, () => api.put('/users/${u['id']}/status', {'status': active ? 'DISABLED' : 'ACTIVE'}),
                        success: active ? 'User disabled' : 'User enabled')) {
                      reload();
                    }
                  },
                  icon: Icon(active ? Icons.block : Icons.check_circle_outline),
                  label: Text(active ? 'Disable sign-in' : 'Enable sign-in'),
                ),
              ],
              if (can['archive'] == true) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
                  onPressed: () async {
                    if (!await confirm(context, 'Remove this user?',
                        body: 'They can no longer sign in. Their work history is kept.', action: 'Remove')) {
                      return;
                    }
                    if (!context.mounted) return;
                    if (await runAction(context, () => api.delete('/users/${u['id']}'), success: 'User removed') &&
                        context.mounted) {
                      Navigator.of(context).pop(true);
                    }
                  },
                  icon: const Icon(Icons.person_remove_outlined),
                  label: const Text('Remove user'),
                ),
              ],
            ],
          ]);
        },
      ),
    );
  }
}

// ================================================================ documents

class DocumentForm extends StatefulWidget {
  const DocumentForm({super.key});
  @override
  State<DocumentForm> createState() => _DocumentFormState();
}

class _DocumentFormState extends State<DocumentForm> with _Lookups {
  final _title = TextEditingController();
  String _ownerType = 'RESTAURANT';
  String? _ownerId;
  String _docType = 'LICENSE';
  String _issued = '';
  String _expires = '';
  File? _file;
  List _owners = const [];

  @override
  void initState() {
    super.initState();
    _loadOwners();
  }

  Future<void> _loadOwners() async {
    setState(() {
      _owners = const [];
      _ownerId = null;
    });
    try {
      final List list = switch (_ownerType) {
        'RESTAURANT' => [for (final r in context.read<Session>().restaurants) {'id': r['id'], 'name': r['name']}],
        'ASSET' => [for (final a in await _list(api, '/assets', {'pageSize': 100, 'sort': 'name:asc'}))
            {'id': (a as Map)['id'], 'name': '${a['name']} · ${(a['restaurant'] as Map?)?['name'] ?? ''}'}],
        'VENDOR' => await _list(api, '/vendors', {'pageSize': 100}),
        _ => [for (final w in await _list(api, '/work-orders', {'pageSize': 100, 'sort': 'createdAt:desc'}))
            {'id': (w as Map)['id'], 'name': '${w['code']} · ${w['title']}'}],
      };
      if (mounted) setState(() => _owners = list);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Upload document')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        AppCard(
          onTap: () async {
            final picked = await FilePicker.pickFile(
              type: FileType.custom,
              allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'docx', 'xlsx'],
            );
            final path = picked?.path;
            if (path != null) {
              setState(() {
                _file = File(path);
                if (_title.text.isEmpty) _title.text = picked!.name.replaceAll(RegExp(r'\.[^.]+$'), '');
              });
            }
          },
          child: Row(children: [
            const IconChip(Icons.upload_file, brand: true, size: 44),
            const SizedBox(width: 12),
            Expanded(
              child: Text(_file == null ? 'Choose a file (PDF, photo, Word, Excel)' : _file!.path.split(Platform.pathSeparator).last,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
          ]),
        ),
        const SizedBox(height: 14),
        Field(_title, 'Title', required: true, hint: 'e.g. FSSAI License 2026'),
        Pick<String>(
          label: 'Type',
          value: _docType,
          items: [for (final t in kDocTypes) (t, label(t))],
          onChanged: (v) => setState(() => _docType = v ?? _docType),
        ),
        Pick<String>(
          label: 'Belongs to',
          value: _ownerType,
          items: const [('RESTAURANT', 'Restaurant'), ('ASSET', 'Asset'), ('VENDOR', 'Vendor'), ('WORK_ORDER', 'Work order')],
          onChanged: (v) {
            _ownerType = v ?? _ownerType;
            _loadOwners();
          },
        ),
        Pick<String>(
          label: label(_ownerType),
          required: true,
          value: _ownerId,
          items: [for (final o in _owners) ((o as Map)['id'].toString(), o['name'].toString())],
          onChanged: (v) => setState(() => _ownerId = v),
        ),
        DateField(label: 'Issued on', value: _issued, onChanged: (v) => setState(() => _issued = v)),
        DateField(label: 'Expires on', value: _expires, onChanged: (v) => setState(() => _expires = v)),
        SaveButton(
          busy: busy,
          text: 'Upload',
          onPressed: () {
            if (_file == null || _ownerId == null) {
              toast(context, 'File aur "${label(_ownerType)}" dono chuniye', error: true);
              return;
            }
            saveAndClose(context, setBusy, () async {
              await api.uploadDocument(_file!, {
                'ownerType': _ownerType,
                'ownerId': _ownerId!,
                'title': _title.text.trim(),
                'docType': _docType,
                'issuedAt': _issued,
                'expiresAt': _expires,
              });
            }, 'Document uploaded');
          },
        ),
      ]),
    );
  }
}

// ================================================================ purchase orders

class PurchaseOrderForm extends StatefulWidget {
  const PurchaseOrderForm({super.key, this.existing});
  final Json? existing;
  @override
  State<PurchaseOrderForm> createState() => _PurchaseOrderFormState();
}

class _PoLine {
  _PoLine({this.partId, String qty = '1', String cost = ''})
      : qty = TextEditingController(text: qty),
        cost = TextEditingController(text: cost);
  String? partId;
  final TextEditingController qty;
  final TextEditingController cost;
}

class _PurchaseOrderFormState extends State<PurchaseOrderForm> with _Lookups {
  late final Json e = widget.existing ?? const {};
  late String? _vendorId = (e['vendor'] as Map?)?['id'];
  late String? _restaurantId = (e['restaurant'] as Map?)?['id'];
  late String _expected = dateText(e['expectedAt']);
  late final _tax = TextEditingController(text: numText(e['tax'] ?? 0));
  late final _notes = TextEditingController(text: e['notes'] ?? '');
  late final List<_PoLine> _lines = [
    for (final it in (e['items'] as List? ?? const []))
      _PoLine(partId: ((it as Map)['part'] as Map)['id'].toString(), qty: numText(it['qtyOrdered']), cost: numText(it['unitCost'])),
  ];
  List _vendors = const [], _parts = const [];

  @override
  void initState() {
    super.initState();
    final rs = context.read<Session>().restaurants;
    _restaurantId ??= rs.isNotEmpty ? rs.first['id'].toString() : null;
    if (_lines.isEmpty) _lines.add(_PoLine());
    Future.wait([_list(api, '/vendors', {'pageSize': 100}), _list(api, '/parts', {'pageSize': 100})]).then((r) {
      if (mounted) {
        setState(() {
          _vendors = r[0];
          _parts = r[1];
        });
      }
    }).catchError((_) {});
  }

  num get _subtotal => _lines.fold<num>(0, (s, l) => s + (num.tryParse(l.qty.text) ?? 0) * (num.tryParse(l.cost.text) ?? 0));

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit purchase order' : 'New purchase order')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Pick<String>(
          label: 'Vendor',
          required: true,
          value: _vendorId,
          items: [for (final v in _vendors) ((v as Map)['id'].toString(), v['name'].toString())],
          onChanged: (v) => setState(() => _vendorId = v),
        ),
        Pick<String>(
          label: 'Deliver to restaurant',
          required: true,
          value: _restaurantId,
          items: _restaurantOptions(context),
          onChanged: (v) => setState(() => _restaurantId = v),
        ),
        DateField(label: 'Expected on', value: _expected, onChanged: (v) => setState(() => _expected = v)),
        const SectionTitle('Items'),
        for (final (i, l) in _lines.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: AppCard(
              child: Column(children: [
                Row(children: [
                  Expanded(
                    child: Pick<String>(
                      label: 'Part ${i + 1}',
                      value: l.partId,
                      items: [for (final p in _parts) ((p as Map)['id'].toString(), '${p['name']} (${p['partNumber']})')],
                      onChanged: (v) => setState(() {
                        l.partId = v;
                        final p = _parts.cast<Map>().where((x) => x['id'] == v).firstOrNull;
                        if (p != null && l.cost.text.isEmpty) l.cost.text = numText(p['unitCost']);
                      }),
                    ),
                  ),
                  if (_lines.length > 1)
                    IconButton(onPressed: () => setState(() => _lines.removeAt(i)), icon: const Icon(Icons.close)),
                ]),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: l.qty,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(labelText: 'Quantity', isDense: true),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: l.cost,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(labelText: 'Unit cost (₹)', isDense: true),
                    ),
                  ),
                ]),
              ]),
            ),
          ),
        TextButton.icon(onPressed: () => setState(() => _lines.add(_PoLine())), icon: const Icon(Icons.add), label: const Text('Add item')),
        const SizedBox(height: 8),
        Field(_tax, 'Tax / GST (₹)', keyboard: const TextInputType.numberWithOptions(decimal: true)),
        Field(_notes, 'Notes', lines: 2),
        AppCard(
          child: Column(children: [
            InfoRow('Subtotal', fmtMoney(_subtotal)),
            InfoRow('Total', fmtMoney(_subtotal + (num.tryParse(_tax.text) ?? 0))),
          ]),
        ),
        SaveButton(
          busy: busy,
          text: editing ? 'Save changes' : 'Save as draft',
          onPressed: () {
            final items = [
              for (final l in _lines)
                if (l.partId != null)
                  {
                    'partId': l.partId,
                    'qtyOrdered': num.tryParse(l.qty.text.trim()) ?? 0,
                    'unitCost': num.tryParse(l.cost.text.trim()) ?? 0,
                    'description': '',
                  },
            ];
            if (_vendorId == null || _restaurantId == null || items.isEmpty) {
              toast(context, 'Vendor, restaurant aur kam se kam ek part chuniye', error: true);
              return;
            }
            saveAndClose(context, setBusy, () async {
              final body = {
                'vendorId': _vendorId,
                'restaurantId': _restaurantId,
                'expectedAt': _expected,
                'tax': num.tryParse(_tax.text.trim()) ?? 0,
                'notes': _notes.text.trim(),
                'items': items,
              };
              editing ? await api.put('/purchase-orders/${e['id']}', body) : await api.post('/purchase-orders', body);
            }, editing ? 'Purchase order updated' : 'Purchase order saved');
          },
        ),
      ]),
    );
  }
}

class PurchaseOrderScreen extends StatefulWidget {
  const PurchaseOrderScreen({super.key, required this.id});
  final String id;
  @override
  State<PurchaseOrderScreen> createState() => _PurchaseOrderScreenState();
}

class _PurchaseOrderScreenState extends State<PurchaseOrderScreen> {
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Purchase order')),
      body: DataView<Json>(
        load: () => api.getData<Json>('/purchase-orders/${widget.id}'),
        builder: (context, po, reload) {
          final a = (po['actions'] as Map?) ?? const {};
          final items = (po['items'] as List?) ?? const [];
          final manager = isManager(context);
          Future<void> act(String path, String done, [Object? body]) async {
            if (await runAction(context, () => api.post('/purchase-orders/${po['id']}/$path', body ?? {}), success: done)) reload();
          }

          Future<void> withReason(String path, String title, String done) async {
            final reason = await askText(context, title: title, hint: 'Reason', action: 'OK', minLength: 3);
            if (reason != null) await act(path, done, {'reason': reason});
          }

          return ListView(padding: const EdgeInsets.all(16), children: [
            Row(children: [
              Text(po['code'].toString(), style: const TextStyle(color: AppColors.muted)),
              const Spacer(),
              StatusBadge(po['status']?.toString()),
            ]),
            const SizedBox(height: 8),
            Text((po['vendor'] as Map?)?['name']?.toString() ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            Text((po['restaurant'] as Map?)?['name']?.toString() ?? '', style: const TextStyle(color: AppColors.muted)),
            const SizedBox(height: 12),
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (final it in items)
                  ListTile(
                    title: Text(((it as Map)['part'] as Map)['name'].toString()),
                    subtitle: Text('${it['qtyOrdered']} × ${fmtMoney(it['unitCost'])}  ·  received ${it['qtyReceived']}'),
                    trailing: Text(fmtMoney(it['lineTotal']), style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
              ]),
            ),
            const SizedBox(height: 10),
            AppCard(
              child: Column(children: [
                InfoRow('Subtotal', fmtMoney(po['subtotal'])),
                InfoRow('Tax', fmtMoney(po['tax'])),
                InfoRow('Total', fmtMoney(po['total'])),
                InfoRow('Requested by', personName(po['requestedBy'])),
                if (po['approvedBy'] != null) InfoRow('Approved by', personName(po['approvedBy'])),
                InfoRow('Expected', fmtDate(po['expectedAt'])),
                if (po['notes'] != null) InfoRow('Notes', po['notes'].toString()),
                if (po['cancellationReason'] != null) InfoRow('Cancelled', po['cancellationReason'].toString()),
              ]),
            ),
            if (po['selfApprovalBlocked'] == true)
              const Padding(
                padding: EdgeInsets.only(top: 10),
                child: Callout(tone: 'warning', text: 'You raised this order, so someone else must approve it.'),
              ),
            if (manager) ...[
              const SizedBox(height: 14),
              Wrap(spacing: 10, runSpacing: 10, children: [
                if (a['edit'] == true)
                  OutlinedButton.icon(
                    onPressed: () async {
                      if (await openEditor(context, PurchaseOrderForm(existing: po))) reload();
                    },
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Edit'),
                  ),
                if (a['submit'] == true)
                  FilledButton.icon(onPressed: () => act('submit', 'Sent for approval'), icon: const Icon(Icons.send_outlined), label: const Text('Submit for approval')),
                if (a['approve'] == true)
                  FilledButton.icon(onPressed: () => act('approve', 'Approved'), icon: const Icon(Icons.verified_outlined), label: const Text('Approve')),
                if (a['reject'] == true)
                  OutlinedButton.icon(onPressed: () => withReason('reject', 'Reject order', 'Rejected'), icon: const Icon(Icons.undo), label: const Text('Reject')),
                if (a['order'] == true)
                  FilledButton.icon(onPressed: () => act('order', 'Marked as ordered'), icon: const Icon(Icons.local_shipping_outlined), label: const Text('Mark ordered')),
                if (a['receive'] == true)
                  FilledButton.icon(
                    onPressed: () async {
                      final lines = [
                        for (final it in items)
                          {
                            'itemId': (it as Map)['id'],
                            'quantity': ((it['qtyOrdered'] as num) - (it['qtyReceived'] as num)).clamp(0, double.infinity),
                          },
                      ];
                      if (await confirm(context, 'Receive everything still pending?', action: 'Receive')) {
                        await act('receive', 'Stock received', {'lines': lines, 'notes': ''});
                      }
                    },
                    icon: const Icon(Icons.inventory_outlined),
                    label: const Text('Receive all'),
                  ),
                if (a['cancel'] == true)
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
                    onPressed: () => withReason('cancel', 'Cancel order', 'Cancelled'),
                    icon: const Icon(Icons.cancel_outlined),
                    label: const Text('Cancel'),
                  ),
              ]),
            ],
          ]);
        },
      ),
    );
  }
}

// ================================================================ work order edit

class WorkOrderEditForm extends StatefulWidget {
  const WorkOrderEditForm({super.key, required this.workOrder});
  final Json workOrder;
  @override
  State<WorkOrderEditForm> createState() => _WorkOrderEditFormState();
}

class _WorkOrderEditFormState extends State<WorkOrderEditForm> with _Lookups {
  late final Json w = widget.workOrder;
  late final _title = TextEditingController(text: w['title'] ?? '');
  late final _desc = TextEditingController(text: w['description'] ?? '');
  late String _category = w['category'] ?? 'OTHER';
  late String _priority = w['priority'] ?? 'MEDIUM';
  late String? _locationId = (w['location'] as Map?)?['id'];
  late String? _assetId = (w['asset'] as Map?)?['id'];
  late DateTime? _due = parseDate(w['dueDate']);
  List _locations = const [], _assets = const [];

  @override
  void initState() {
    super.initState();
    final rid = (w['restaurant'] as Map)['id'];
    Future.wait([
      api.getData<List>('/locations', {'restaurantId': rid}),
      _list(api, '/assets', {'restaurantId': rid, 'pageSize': 100, 'sort': 'name:asc'}),
    ]).then((r) {
      if (mounted) {
        setState(() {
          _locations = r[0];
          _assets = r[1];
        });
      }
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Edit ${w['code']}')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Field(_title, 'Title', required: true),
        Field(_desc, 'Description', lines: 3),
        Row(children: [
          Expanded(
            child: Pick<String>(
              label: 'Category',
              value: _category,
              items: [for (final c in kCategories) (c, label(c))],
              onChanged: (v) => setState(() => _category = v ?? _category),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Pick<String>(
              label: 'Priority',
              value: _priority,
              items: [for (final p in kPriorities) (p, label(p))],
              onChanged: (v) => setState(() => _priority = v ?? _priority),
            ),
          ),
        ]),
        Pick<String>(
          label: 'Location',
          value: _locationId,
          items: [(null, 'None'), for (final l in _locations) ((l as Map)['id'].toString(), l['name'].toString())],
          onChanged: (v) => setState(() => _locationId = v),
        ),
        Pick<String>(
          label: 'Asset',
          value: _assetId,
          items: [(null, 'None'), for (final a in _assets) ((a as Map)['id'].toString(), '${a['name']} · ${a['assetCode']}')],
          onChanged: (v) => setState(() => _assetId = v),
        ),
        OutlinedButton.icon(
          onPressed: () async {
            final now = DateTime.now();
            final d = await showDatePicker(
                context: context, firstDate: now.subtract(const Duration(days: 365)), lastDate: now.add(const Duration(days: 365)), initialDate: _due ?? now);
            if (d == null || !context.mounted) return;
            final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_due ?? DateTime(0, 1, 1, 18)));
            setState(() => _due = DateTime(d.year, d.month, d.day, t?.hour ?? 18, t?.minute ?? 0));
          },
          icon: const Icon(Icons.event_outlined),
          label: Text(_due == null ? 'Set due date' : 'Due ${fmtDateTime(_due!.toIso8601String())}'),
        ),
        SaveButton(
          busy: busy,
          text: 'Save changes',
          onPressed: () => saveAndClose(context, setBusy, () async {
            await api.put('/work-orders/${w['id']}', {
              'title': _title.text.trim(),
              'description': _desc.text.trim(),
              'category': _category,
              'priority': _priority,
              'restaurantId': (w['restaurant'] as Map)['id'],
              'locationId': _locationId ?? '',
              'assetId': _assetId ?? '',
              'dueDate': _due?.toUtc().toIso8601String() ?? '',
              'estimatedMinutes': ?w['estimatedMinutes'],
            });
          }, 'Work order updated'),
        ),
      ]),
    );
  }
}
