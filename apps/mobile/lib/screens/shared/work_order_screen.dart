import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/checklist.dart';
import '../../widgets/common.dart';
import '../../widgets/photos.dart';
import '../admin/editors.dart';
import 'asset_screen.dart';

/// One work order / task. Workers start, pause, answer the checklist, add photos and
/// complete it; managers also assign, verify, send back, reopen and cancel.
/// Which buttons show comes from the server's `actions` flags, like the web app.
class WorkOrderScreen extends StatefulWidget {
  const WorkOrderScreen({super.key, required this.id, this.title});
  final String id;
  final String? title;
  @override
  State<WorkOrderScreen> createState() => _WorkOrderScreenState();
}

class _WorkOrderScreenState extends State<WorkOrderScreen> {
  Json? _w;
  Object? _error;
  String? _busy;

  ApiClient get api => apiOf(context);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final w = await api.getData<Json>('/work-orders/${widget.id}');
      if (mounted) {
        setState(() {
          _w = w;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  /// Runs a call that returns the fresh work order.
  Future<void> _do(String key, Future<dynamic> Function() call, [String? done]) async {
    setState(() => _busy = key);
    try {
      final r = await call();
      if (r is Map && r['id'] == widget.id) {
        setState(() => _w = r.cast<String, dynamic>());
      } else {
        await _load();
      }
      if (done != null && mounted) toast(context, done);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  String get _base => '/work-orders/${widget.id}';
  Future<dynamic> _action(String path, [Object? body]) => api.postData<dynamic>('$_base/$path', body ?? {});

  @override
  Widget build(BuildContext context) {
    final w = _w;
    return Scaffold(
      appBar: AppBar(title: Text(w?['code']?.toString() ?? widget.title ?? 'Task')),
      body: w == null
          ? (_error != null
              ? ErrorView(error: _error!, onRetry: _load)
              : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(onRefresh: _load, child: _body(w)),
      bottomNavigationBar: w == null ? null : _bottomBar(w),
    );
  }

  Widget? _bottomBar(Json w) {
    final a = (w['actions'] as Map?) ?? const {};
    final check = (w['completionCheck'] as Map?) ?? const {};
    final blockers = (check['stepsLeft'] as int? ?? 0) +
        (check['needsBeforePhoto'] == true ? 1 : 0) +
        (check['needsAfterPhoto'] == true ? 1 : 0) +
        (check['subWorkOrdersOpen'] as int? ?? 0);
    final buttons = <Widget>[];
    Widget btn(String key, String text, IconData icon, VoidCallback onTap, {bool primary = true}) {
      final child = _busy == key
          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.2))
          : Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(icon, size: 20),
              const SizedBox(width: 6),
              Flexible(child: Text(text, overflow: TextOverflow.ellipsis)),
            ]);
      return Expanded(
        child: primary
            ? FilledButton(onPressed: _busy == null ? onTap : null, child: child)
            : OutlinedButton(onPressed: _busy == null ? onTap : null, child: child),
      );
    }

    if (a['publish'] == true) {
      buttons.add(btn('publish', 'Publish', Icons.send_outlined, () => _do('publish', () => _action('publish'), 'Published')));
    }
    if (a['start'] == true) {
      buttons.add(btn('start', 'Start task', Icons.play_arrow_rounded, () => _do('start', () => _action('start'), 'Task started')));
    } else if (a['resume'] == true) {
      buttons.add(btn('resume', 'Resume', Icons.play_arrow_rounded, () => _do('resume', () => _action('resume'), 'Resumed')));
    } else if (a['complete'] == true) {
      if (a['hold'] == true) {
        buttons.add(btn('hold', 'Hold', Icons.pause_rounded, _hold, primary: false));
        buttons.add(const SizedBox(width: 10));
      }
      buttons.add(btn('complete', 'Complete', Icons.check_circle_outline, _complete));
    }
    if (a['verify'] == true) {
      if (a['reject'] == true) {
        buttons.add(btn('reject', 'Send back', Icons.undo_rounded, _reject, primary: false));
        buttons.add(const SizedBox(width: 10));
      }
      buttons.add(btn('verify', 'Verify & close', Icons.verified_outlined, _verify));
    }
    if (buttons.isEmpty && a['assign'] == true) {
      buttons.add(btn('assign', w['assignedUser'] == null ? 'Assign' : 'Reassign', Icons.person_add_alt, _assign));
    }
    if (buttons.isEmpty && a['reopen'] == true) {
      buttons.add(btn('reopen', 'Reopen', Icons.replay_rounded, _reopen, primary: false));
    }
    if (buttons.isEmpty) return null;
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (a['complete'] == true && blockers > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('$blockers thing${blockers == 1 ? '' : 's'} left before you can complete',
                  style: const TextStyle(fontSize: 12.5, color: AppColors.warningFg)),
            ),
          Row(children: buttons),
        ]),
      ),
    );
  }

  Widget _body(Json w) {
    final a = (w['actions'] as Map?) ?? const {};
    final status = w['status']?.toString();
    final active = kActiveStatuses.contains(status);
    final due = active ? describeDue(w['dueDate']) : null;
    final asset = w['asset'] as Map?;
    final where = [asset?['name'], (w['location'] as Map?)?['name'], (w['restaurant'] as Map?)?['name']]
        .whereType<String>()
        .join(' · ');
    final checklist = (w['checklist'] as List?) ?? const [];
    final progress = checklistProgress(checklist);
    final helpers = (w['helpers'] as List?) ?? const [];
    final source = w['sourceRequest'] as Map?;
    final completion = w['completion'] as Map?;
    final contacts = (w['contacts'] as List?) ?? const [];
    final parts = (w['parts'] as List?) ?? const [];
    final cost = w['cost'] as Map?;
    final history = (w['history'] as List?) ?? const [];
    final menu = <(String, String, IconData)>[
      if (a['edit'] == true && isManager(context)) ('edit', 'Edit details', Icons.edit_outlined),
      if (a['assign'] == true && (a['start'] == true || a['complete'] == true || a['verify'] == true))
        ('assign', 'Reassign', Icons.person_add_alt),
      if (a['hold'] == true && a['complete'] != true) ('hold', 'Put on hold', Icons.pause_circle_outline),
      if (a['reopen'] == true) ('reopen', 'Reopen', Icons.replay_rounded),
      if (a['cancel'] == true) ('cancel', 'Cancel work order', Icons.cancel_outlined),
    ];

    return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 32), children: [
      Row(children: [
        StatusBadge(status),
        const SizedBox(width: 8),
        PriorityBadge(w['priority']?.toString()),
        const SizedBox(width: 8),
        Pill(label(w['category'])),
        const Spacer(),
        if (menu.isNotEmpty)
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert),
            onSelected: (k) => switch (k) {
              'edit' => _edit(),
              'assign' => _assign(),
              'hold' => _hold(),
              'reopen' => _reopen(),
              'cancel' => _cancel(),
              _ => null,
            },
            itemBuilder: (_) => [
              for (final m in menu)
                PopupMenuItem(value: m.$1, child: Row(children: [Icon(m.$3, size: 20), const SizedBox(width: 10), Text(m.$2)])),
            ],
          ),
      ]),
      const SizedBox(height: 10),
      Text(w['title'].toString(), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600, height: 1.25)),
      const SizedBox(height: 6),
      LabelChips(w['labels'] as List?),
      const SizedBox(height: 6),
      InkWell(
        onTap: asset == null
            ? null
            : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AssetScreen(id: asset['id'].toString()))),
        child: Text(where,
            style: TextStyle(
                fontSize: 13.5,
                color: asset == null ? AppColors.muted : AppColors.primary,
                decoration: asset == null ? null : TextDecoration.underline)),
      ),
      if (due != null && due.label.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(due.label,
              style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w500,
                  color: w['overdue'] == true ? AppColors.dangerFg : toneColors(due.tone).fg)),
        ),
      if (w['description'] != null && w['description'].toString().isNotEmpty) ...[
        const SizedBox(height: 10),
        Text(w['description'].toString(), style: const TextStyle(fontSize: 14.5, height: 1.4)),
      ],
      if ((w['minutesWorked'] ?? 0) > 0 || w['timerRunning'] == true) ...[
        const SizedBox(height: 8),
        Row(children: [
          const Icon(Icons.timer_outlined, size: 16, color: AppColors.muted),
          const SizedBox(width: 4),
          Text('Time worked: ${fmtDuration(w['minutesWorked'])}',
              style: const TextStyle(fontSize: 13, color: AppColors.muted)),
          if (w['timerRunning'] == true)
            const Text(' · timer running', style: TextStyle(fontSize: 13, color: AppColors.warningFg)),
        ]),
      ],
      const SizedBox(height: 14),
      if (status == 'ON_HOLD' && w['holdReason'] != null)
        _gap(Callout(tone: 'warning', title: 'On hold because', text: w['holdReason'].toString())),
      if (status == 'REVIEW')
        _gap(const Callout(title: 'Sent for review', text: 'Your supervisor will check the work.')),
      if (status == 'REOPENED' && w['rejectionReason'] != null)
        _gap(Callout(tone: 'danger', title: 'Sent back for rework', text: w['rejectionReason'].toString())),
      if (status == 'CANCELLED')
        _gap(Callout(tone: 'warning', title: 'Cancelled', text: (w['cancelReason'] ?? '').toString())),
      if (w['scheduledStart'] != null && (status == 'SCHEDULED' || status == 'ASSIGNED'))
        _gap(Callout(text: 'Planned for ${fmtDateTime(w['scheduledStart'])}')),

      AppCard(
        child: Column(children: [
          InfoRow('Assigned to', w['assignedUser'] != null ? personName(w['assignedUser']) : 'Not assigned'),
          if (w['assignedTeam'] != null) InfoRow('Team', (w['assignedTeam'] as Map)['name'].toString()),
          if (helpers.isNotEmpty) InfoRow('Helpers', helpers.map(personName).join(', ')),
          if (w['supervisor'] != null) InfoRow('Supervisor', personName(w['supervisor'])),
          if (w['vendor'] != null) InfoRow('Vendor', (w['vendor'] as Map)['name'].toString()),
          InfoRow('Type', label(w['type'])),
          InfoRow('Created', '${fmtDateTime(w['createdAt'])} · ${personName(w['createdBy'])}'),
          if (w['estimatedMinutes'] != null) InfoRow('Estimate', fmtDuration(w['estimatedMinutes'])),
          if (w['procedure'] != null) InfoRow('Procedure', (w['procedure'] as Map)['name'].toString()),
        ]),
      ),
      const SizedBox(height: 18),

      if (source != null) ...[
        SectionTitle('Reported by ${source['requestedBy'] != null ? personName(source['requestedBy']) : ((source['guest'] as Map?)?['name'] ?? 'guest')}'),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(source['description']?.toString() ?? ''),
            const SizedBox(height: 8),
            PhotoGrid(source['attachments'] as List?),
          ]),
        ),
        const SizedBox(height: 18),
      ],

      if (checklist.isNotEmpty) ...[
        SectionTitle('Checklist',
            trailing: Text('${progress.answered} of ${progress.total} done',
                style: const TextStyle(fontSize: 13, color: AppColors.muted))),
        if (a['checklist'] != true && active)
          _gap(const Callout(tone: 'neutral', text: 'Start the task to fill in the checklist.')),
        if (a['checklist'] == true && progress.failed > 0)
          _gap(Callout(tone: 'warning', text: '${progress.failed} check(s) failed — add a note or photo.')),
        ChecklistView(
          items: checklist,
          editable: a['checklist'] == true,
          onAnswer: (itemId, answer) async {
            final r = await api.putData<Json>('$_base/checklist/$itemId', answer);
            if (mounted) setState(() => _w = r);
          },
          onUpload: (itemId) async {
            final files = await pickPhotos(context);
            if (files.isEmpty) return;
            final r = await api.upload('$_base/checklist/$itemId/attachments', files);
            if (mounted) setState(() => _w = r);
          },
        ),
        const SizedBox(height: 10),
      ],

      if (parts.isNotEmpty) ...[
        const SectionTitle('Parts'),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(children: [
            for (final p in parts)
              ListTile(
                dense: true,
                leading: const Icon(Icons.inventory_2_outlined),
                title: Text(((p as Map)['part'] as Map)['name'].toString()),
                subtitle: Text((p['part'] as Map)['partNumber']?.toString() ?? ''),
                trailing: Text('${p['qtyUsed']} ${(p['part'] as Map)['unit'] ?? ''}',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
          ]),
        ),
        const SizedBox(height: 18),
      ],

      SectionTitle('Photos',
          trailing: a['upload'] == true
              ? TextButton.icon(
                  onPressed: _busy == null ? _addPhotos : null,
                  icon: _busy == 'upload'
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.add_a_photo_outlined, size: 18),
                  label: const Text('Add photo'),
                )
              : null),
      if (((w['attachments'] as List?) ?? const []).isEmpty)
        const Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Text('No photos yet.', style: TextStyle(color: AppColors.muted)),
        )
      else
        PhotoGrid(w['attachments'] as List?),
      const SizedBox(height: 18),

      if (completion != null) ...[
        const SectionTitle('Repair report'),
        AppCard(
          child: Column(children: [
            InfoRow('Problem found', completion['problemFound']?.toString()),
            if (completion['rootCause'] != null) InfoRow('Root cause', completion['rootCause'].toString()),
            InfoRow('Work performed', completion['workPerformed']?.toString()),
            if (completion['newPartsInstalled'] != null) InfoRow('New parts', completion['newPartsInstalled'].toString()),
            if (completion['oldPartsRemoved'] != null) InfoRow('Old parts removed', completion['oldPartsRemoved'].toString()),
            if (completion['recommendation'] != null) InfoRow('Recommendation', completion['recommendation'].toString()),
            InfoRow('Final condition', label(completion['finalCondition'])),
            InfoRow('Confirmed by', '${personName(completion['confirmedBy'])} · ${fmtDateTime(completion['confirmedAt'])}'),
          ]),
        ),
        const SizedBox(height: 18),
      ],

      if (cost != null && (cost['total'] ?? 0) > 0) ...[
        const SectionTitle('Cost'),
        AppCard(
          child: Column(children: [
            InfoRow('Parts', fmtMoney(cost['parts'])),
            InfoRow('Labour', fmtMoney(cost['labour'])),
            InfoRow('Vendor', fmtMoney(cost['vendor'])),
            InfoRow('Other', fmtMoney(cost['other'])),
            const Divider(),
            InfoRow('Total', fmtMoney(cost['total'])),
          ]),
        ),
        const SizedBox(height: 18),
      ],

      if (contacts.isNotEmpty) ...[
        const SectionTitle('Contacts'),
        for (final c in contacts)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text((c as Map)['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(label(c['role']), style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                  ]),
                ),
                if (c['phone'] != null)
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 38)),
                    onPressed: () => launchUrl(Uri.parse('tel:${c['phone'].toString().replaceAll(' ', '')}')),
                    icon: const Icon(Icons.call_outlined, size: 18),
                    label: const Text('Call'),
                  ),
              ]),
            ),
          ),
        const SizedBox(height: 10),
      ],

      const SectionTitle('Messages'),
      _Messages(
        messages: (w['messages'] as List?) ?? const [],
        canSend: a['message'] == true,
        canInternal: a['internalNotes'] == true,
        send: (body, internal) => _do('message', () => _action('messages', {'body': body, if (internal) 'internal': true})),
      ),

      if (history.isNotEmpty) ...[
        const SizedBox(height: 18),
        const SectionTitle('History'),
        AppCard(
          child: Column(children: [
            for (final h in history.reversed)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Icon(Icons.circle, size: 8, color: AppColors.primary),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(
                          (h as Map)['fromStatus'] == null
                              ? 'Created as ${label(h['toStatus'])}'
                              : '${label(h['fromStatus'])} → ${label(h['toStatus'])}',
                          style: const TextStyle(fontWeight: FontWeight.w500)),
                      Text('${h['actor'] != null ? personName(h['actor']) : 'System'} · ${fmtDateTime(h['createdAt'])}',
                          style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                      if (h['note'] != null) Text(h['note'].toString(), style: const TextStyle(fontSize: 13)),
                    ]),
                  ),
                ]),
              ),
          ]),
        ),
      ],
    ]);
  }

  Widget _gap(Widget child) => Padding(padding: const EdgeInsets.only(bottom: 12), child: child);

  // ------------------------------------------------------------- actions

  Future<void> _edit() async {
    if (await openEditor(context, WorkOrderEditForm(workOrder: _w!))) await _load();
  }

  Future<void> _addPhotos() async {
    final stage = await pickOption<String>(context, 'Which photo is this?', [
      ('BEFORE', 'Before work'),
      ('DURING', 'During work'),
      ('AFTER', 'After work'),
    ]);
    if (stage == null || !mounted) return;
    final files = await pickPhotos(context);
    if (files.isEmpty) return;
    await _do('upload', () => api.upload('$_base/attachments', files, {'stage': stage}), 'Photo added');
  }

  Future<void> _hold() async {
    final reason = await askText(context, title: 'Put on hold', hint: 'Why? (e.g. waiting for parts)', action: 'Hold', minLength: 3);
    if (reason == null) return;
    await _do('hold', () => _action('hold', {'reason': reason}), 'On hold');
  }

  Future<void> _reject() async {
    final reason = await askText(context, title: 'Send back for rework', hint: 'What needs fixing?', action: 'Send back', minLength: 3);
    if (reason == null) return;
    await _do('reject', () => _action('reject', {'reason': reason}), 'Sent back');
  }

  Future<void> _reopen() async {
    final reason = await askText(context, title: 'Reopen work order', hint: 'Reason', action: 'Reopen', minLength: 3);
    if (reason == null) return;
    await _do('reopen', () => _action('reopen', {'reason': reason}), 'Reopened');
  }

  Future<void> _cancel() async {
    final reason = await askText(context, title: 'Cancel work order', hint: 'Reason', action: 'Cancel work order', minLength: 3);
    if (reason == null) return;
    await _do('cancel', () => _action('cancel', {'reason': reason}), 'Cancelled');
  }

  Future<void> _verify() async {
    final note = await askText(context, title: 'Verify the work', hint: 'Note (optional)', action: 'Verify');
    if (note == null) return;
    await _do('verify', () => _action('verify', {'note': note}), 'Verified');
  }

  Future<void> _assign() async {
    final rid = (_w?['restaurant'] as Map?)?['id'];
    List people;
    try {
      people = await api.getData<List>('/work-orders/workload', {'restaurantId': rid});
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
      return;
    }
    if (!mounted) return;
    final userId = await pickOption<String>(context, 'Assign to', [
      for (final p in people)
        (
          ((p as Map)['user'] as Map)['id'].toString(),
          '${personName(p['user'])}  ·  ${p['openCount']} open${(p['overdueCount'] ?? 0) > 0 ? ', ${p['overdueCount']} overdue' : ''}'
        ),
    ]);
    if (userId == null) return;
    // The API wants both fields; '' means "no team".
    await _do('assign', () => _action('assign', {'assignedUserId': userId, 'assignedTeamId': ''}), 'Assigned');
  }

  Future<void> _complete() async {
    final body = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(fullscreenDialog: true, builder: (_) => CompleteScreen(workOrder: _w!)),
    );
    if (body == null) return;
    await _do('complete', () => _action('complete', body), 'Task completed');
  }
}

class _Messages extends StatefulWidget {
  const _Messages({required this.messages, required this.canSend, required this.canInternal, required this.send});
  final List messages;
  final bool canSend;
  final bool canInternal;
  final Future<void> Function(String body, bool internal) send;
  @override
  State<_Messages> createState() => _MessagesState();
}

class _MessagesState extends State<_Messages> {
  final _ctrl = TextEditingController();
  bool _internal = false;
  bool _sending = false;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (widget.messages.isEmpty)
        const Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Text('No messages yet.', style: TextStyle(color: AppColors.muted)),
        ),
      for (final m in widget.messages)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Avatar((m as Map)['author'], size: 32),
            const SizedBox(width: 10),
            Expanded(
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: m['internal'] == true ? AppColors.warningSoft : (m['mine'] == true ? AppColors.infoSoft : Colors.white),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(
                      child: Text(personName(m['author']),
                          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                    ),
                    if (m['internal'] == true) const Pill('Internal', tone: 'warning'),
                  ]),
                  const SizedBox(height: 2),
                  Text(m['body'].toString(), style: const TextStyle(fontSize: 14)),
                  const SizedBox(height: 4),
                  Text(fmtRelative(m['createdAt']), style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                  if ((m['attachments'] as List? ?? const []).isNotEmpty) ...[
                    const SizedBox(height: 6),
                    PhotoGrid(m['attachments'] as List?, columns: 4),
                  ],
                ]),
              ),
            ),
          ]),
        ),
      if (widget.canSend) ...[
        TextField(
          controller: _ctrl,
          minLines: 1,
          maxLines: 4,
          decoration: InputDecoration(
            hintText: 'Write a message…',
            suffixIcon: IconButton(
              icon: _sending
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.send_rounded, color: AppColors.primary),
              onPressed: _sending
                  ? null
                  : () async {
                      final text = _ctrl.text.trim();
                      if (text.isEmpty) return;
                      setState(() => _sending = true);
                      await widget.send(text, _internal);
                      if (mounted) {
                        _ctrl.clear();
                        setState(() => _sending = false);
                      }
                    },
            ),
          ),
        ),
        if (widget.canInternal)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            value: _internal,
            onChanged: (v) => setState(() => _internal = v == true),
            title: const Text('Internal note (managers only)'),
            controlAffinity: ListTileControlAffinity.leading,
          ),
      ],
    ]);
  }
}

/// The repair report a technician hands in (same fields as the web CompletionForm).
class CompleteScreen extends StatefulWidget {
  const CompleteScreen({super.key, required this.workOrder});
  final Json workOrder;
  @override
  State<CompleteScreen> createState() => _CompleteScreenState();
}

class _CompleteScreenState extends State<CompleteScreen> {
  final _problem = TextEditingController();
  final _root = TextEditingController();
  final _work = TextEditingController();
  final _newParts = TextEditingController();
  final _oldParts = TextEditingController();
  final _rec = TextEditingController();
  String _condition = 'FULLY_WORKING';
  late bool _noParts;
  bool _confirmed = false;
  String _assetStatus = '';

  @override
  void initState() {
    super.initState();
    _noParts = ((widget.workOrder['parts'] as List?) ?? const []).isEmpty;
  }

  @override
  Widget build(BuildContext context) {
    final check = (widget.workOrder['completionCheck'] as Map?) ?? const {};
    final hasAsset = widget.workOrder['asset'] != null;
    final ok = _problem.text.trim().length >= 3 && _work.text.trim().length >= 3 && _confirmed;
    Widget field(TextEditingController c, String label, {String? hint, int lines = 2, bool required = false}) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextField(
            controller: c,
            minLines: lines,
            maxLines: lines + 3,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(labelText: required ? '$label *' : label, hintText: hint, alignLabelWithHint: true),
          ),
        );
    return Scaffold(
      appBar: AppBar(title: const Text('Complete task')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if ((check['stepsLeft'] ?? 0) > 0)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Callout(tone: 'warning', text: '${check['stepsLeft']} checklist step(s) still to answer.'),
          ),
        if (check['needsBeforePhoto'] == true)
          const Padding(padding: EdgeInsets.only(bottom: 10), child: Callout(tone: 'warning', text: 'Add a BEFORE photo first.')),
        if (check['needsAfterPhoto'] == true)
          const Padding(padding: EdgeInsets.only(bottom: 10), child: Callout(tone: 'warning', text: 'Add an AFTER photo first.')),
        field(_problem, 'Problem found', hint: 'What was wrong?', required: true),
        field(_root, 'Root cause', hint: 'Why did it happen?'),
        field(_work, 'Work performed', hint: 'What did you do?', lines: 3, required: true),
        field(_newParts, 'New parts installed'),
        field(_oldParts, 'Old parts removed'),
        field(_rec, 'Recommendation', hint: 'Anything the manager should know?'),
        DropdownButtonFormField<String>(
          initialValue: _condition,
          decoration: const InputDecoration(labelText: 'Final condition *'),
          items: [for (final c in kFinalConditions) DropdownMenuItem(value: c, child: Text(label(c)))],
          onChanged: (v) => setState(() => _condition = v ?? _condition),
        ),
        if (hasAsset) ...[
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _assetStatus,
            decoration: const InputDecoration(labelText: 'Set machine status'),
            items: const [
              DropdownMenuItem(value: '', child: Text('Leave unchanged')),
              DropdownMenuItem(value: 'OPERATIONAL', child: Text('Operational')),
              DropdownMenuItem(value: 'WARNING', child: Text('Warning')),
              DropdownMenuItem(value: 'BROKEN', child: Text('Broken')),
            ],
            onChanged: (v) => setState(() => _assetStatus = v ?? ''),
          ),
        ],
        const SizedBox(height: 8),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: _noParts,
          onChanged: (v) => setState(() => _noParts = v == true),
          title: const Text('No parts used'),
          controlAffinity: ListTileControlAffinity.leading,
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: _confirmed,
          onChanged: (v) => setState(() => _confirmed = v == true),
          title: const Text('I confirm this report is true and the work is done'),
          controlAffinity: ListTileControlAffinity.leading,
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: ok
              ? () => Navigator.pop(context, <String, dynamic>{
                    'problemFound': _problem.text.trim(),
                    'rootCause': _root.text.trim(),
                    'workPerformed': _work.text.trim(),
                    'newPartsInstalled': _newParts.text.trim(),
                    'oldPartsRemoved': _oldParts.text.trim(),
                    'recommendation': _rec.text.trim(),
                    'finalCondition': _condition,
                    'noPartsUsed': _noParts,
                    'confirmed': true,
                    if (_assetStatus.isNotEmpty) 'assetStatus': _assetStatus,
                  })
              : null,
          icon: const Icon(Icons.check_circle_outline),
          label: const Text('Complete task'),
        ),
      ]),
    );
  }
}
