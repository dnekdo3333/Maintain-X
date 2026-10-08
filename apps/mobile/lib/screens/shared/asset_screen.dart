import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../admin/editors.dart';
import 'report_screen.dart';
import 'work_order_screen.dart';

/// Assets the user can see (worker: My assets, admin: Assets tab).
class AssetsScreen extends StatefulWidget {
  const AssetsScreen({super.key, this.embedded = false});
  final bool embedded;
  @override
  State<AssetsScreen> createState() => _AssetsScreenState();
}

class _AssetsScreenState extends State<AssetsScreen> {
  String _q = '';
  String? _status;
  final _key = GlobalKey<DataViewState<List>>();

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final list = Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: TextField(
          decoration: const InputDecoration(
              hintText: 'Search assets', prefixIcon: Icon(Icons.search), isDense: true),
          onSubmitted: (v) {
            _q = v;
            _key.currentState?.reload();
          },
        ),
      ),
      SizedBox(
        height: 44,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), children: [
          for (final s in const [null, 'OPERATIONAL', 'WARNING', 'UNDER_MAINTENANCE', 'BROKEN'])
            Padding(
              padding: const EdgeInsets.only(right: 8, top: 6),
              child: ChoiceChip(
                label: Text(s == null ? 'All' : label(s)),
                selected: _status == s,
                onSelected: (_) {
                  setState(() => _status = s);
                  _key.currentState?.reload();
                },
              ),
            ),
        ]),
      ),
      Expanded(
        child: DataView<List>(
          key: _key,
          load: () async => (await api.get('/assets', {
            'pageSize': 100,
            'q': _q,
            'status': _status,
            'sort': 'name:asc',
          }) as Map)['data'] as List,
          builder: (context, items, _) => items.isEmpty
              ? ListView(children: const [EmptyState(icon: Icons.inventory_2_outlined, title: 'No assets found')])
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, i) => AssetCard(asset: items[i] as Map),
                ),
        ),
      ),
    ]);
    if (widget.embedded) return list;
    return Scaffold(appBar: AppBar(title: const Text('My assets')), body: list);
  }
}

class AssetCard extends StatelessWidget {
  const AssetCard({super.key, required this.asset});
  final Map asset;
  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: () => Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => AssetScreen(id: asset['id'].toString()))),
      child: Row(children: [
        const IconChip(Icons.kitchen_outlined, size: 42),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(asset['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
            const SizedBox(height: 2),
            Text(
              [asset['assetCode'], (asset['location'] as Map?)?['name'], (asset['restaurant'] as Map?)?['name']]
                  .whereType<String>()
                  .join(' · '),
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          ]),
        ),
        const SizedBox(width: 8),
        StatusBadge(asset['status']?.toString()),
      ]),
    );
  }
}

class AssetScreen extends StatelessWidget {
  const AssetScreen({super.key, this.id, this.publicId});
  final String? id;
  final String? publicId;

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Asset')),
      body: DataView<Json>(
        load: () => id != null
            ? api.getData<Json>('/assets/$id')
            : api.getData<Json>('/assets/by-public/$publicId'),
        builder: (context, a, reload) {
          final open = (a['openWorkOrders'] as List?) ?? const [];
          final recent = (a['recentWorkOrders'] as List?) ?? const [];
          final history = (a['history'] as List?) ?? const [];
          final restaurant = a['restaurant'] as Map?;
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Row(children: [
                const IconChip(Icons.kitchen_outlined, size: 52, brand: true),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(a['name'].toString(), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                    Text('${a['assetCode']} · ${(a['category'] as Map?)?['name'] ?? ''}',
                        style: const TextStyle(color: AppColors.muted)),
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, children: [
                      StatusBadge(a['status']?.toString()),
                      Pill('${label(a['criticality'])} criticality', tone: priorityTone(a['criticality']?.toString())),
                    ]),
                  ]),
                ),
              ]),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => ReportScreen(
                  restaurantId: restaurant?['id']?.toString(),
                  assetId: a['id'].toString(),
                  assetName: a['name'].toString(),
                ),
              )),
              icon: const Icon(Icons.campaign_outlined),
              label: const Text('Report a problem'),
            ),
            AssetAdminActions(asset: a, onChanged: reload),
            const SizedBox(height: 16),
            if (open.isNotEmpty) ...[
              const SectionTitle('Open work'),
              for (final w in open)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(
                    task: w as Map,
                    onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => WorkOrderScreen(id: w['id'].toString()))),
                  ),
                ),
              const SizedBox(height: 6),
            ],
            const SectionTitle('Details'),
            AppCard(
              child: Column(children: [
                InfoRow('Restaurant', restaurant?['name']?.toString()),
                InfoRow('Location', (a['location'] as Map?)?['name']?.toString()),
                InfoRow('Manufacturer', a['manufacturer']?.toString()),
                InfoRow('Model', a['model']?.toString()),
                InfoRow('Serial no.', a['serialNumber']?.toString()),
                InfoRow('Installed', fmtDate(a['installDate'])),
                InfoRow('Warranty till', fmtDate(a['warrantyEnd'])),
                if (a['vendor'] != null) InfoRow('Vendor', '${(a['vendor'] as Map)['name']}  ${(a['vendor'] as Map)['phone'] ?? ''}'),
                if (a['purchaseCost'] != null) InfoRow('Purchase cost', fmtMoney(a['purchaseCost'])),
                if ((a['downtimeHours90d'] ?? 0) > 0) InfoRow('Downtime (90 d)', '${a['downtimeHours90d']} h'),
              ]),
            ),
            if (a['notes'] != null) ...[
              const SizedBox(height: 12),
              Callout(tone: 'neutral', text: a['notes'].toString()),
            ],
            if (recent.isNotEmpty) ...[
              const SizedBox(height: 16),
              const SectionTitle('Recent work'),
              for (final w in recent)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(
                    task: w as Map,
                    onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => WorkOrderScreen(id: w['id'].toString()))),
                  ),
                ),
            ],
            if (history.isNotEmpty) ...[
              const SizedBox(height: 16),
              const SectionTitle('History'),
              AppCard(
                child: Column(children: [
                  for (final h in history)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.history, size: 20),
                      title: Text((h as Map)['note']?.toString() ?? label(h['eventType'])),
                      subtitle: Text('${label(h['eventType'])} · ${fmtDate(h['occurredAt'])}'),
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

/// Reads a printed QR code (`<site>/a/<publicId>`) and opens the asset.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key, this.embedded = false});
  final bool embedded;
  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates);
  bool _handled = false;
  final _manual = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _open(String raw) {
    final m = RegExp(r'/([alp])/([0-9A-Za-z]{8,40})').firstMatch(raw);
    final code = m?.group(2) ?? (RegExp(r'^[0-9A-Za-z]{8,40}$').hasMatch(raw.trim()) ? raw.trim() : null);
    if (code == null || (m != null && m.group(1) != 'a')) {
      toast(context, 'Ye asset ka QR code nahi hai.', error: true);
      return;
    }
    _handled = true;
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => AssetScreen(publicId: code)))
        .then((_) => _handled = false);
  }

  @override
  Widget build(BuildContext context) {
    final body = Column(children: [
      Expanded(
        child: Stack(children: [
          MobileScanner(
            controller: _controller,
            onDetect: (capture) {
              if (_handled) return;
              final v = capture.barcodes.firstOrNull?.rawValue;
              if (v != null) _open(v);
            },
            errorBuilder: (context, error) => Container(
              color: Colors.black,
              alignment: Alignment.center,
              padding: const EdgeInsets.all(24),
              child: Text('Camera nahi khul paya: ${error.errorCode.name}',
                  textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
            ),
          ),
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white, width: 3),
                borderRadius: BorderRadius.circular(20),
              ),
            ),
          ),
          const Positioned(
            left: 0,
            right: 0,
            bottom: 24,
            child: Text('Point the camera at the QR label on the machine',
                textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 14)),
          ),
        ]),
      ),
      Container(
        color: Colors.white,
        padding: const EdgeInsets.all(16),
        child: Row(children: [
          Expanded(
            child: TextField(
              controller: _manual,
              decoration: const InputDecoration(hintText: 'Or type the code on the label', isDense: true),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(64, 46)),
            onPressed: () => _open(_manual.text),
            child: const Text('Open'),
          ),
        ]),
      ),
    ]);
    if (widget.embedded) return body;
    return Scaffold(appBar: AppBar(title: const Text('Scan')), body: body);
  }
}
