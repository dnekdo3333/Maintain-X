import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../core/theme.dart';

ApiClient apiOf(BuildContext context) => context.read<Session>().api;

void toast(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      behavior: SnackBarBehavior.floating,
      backgroundColor: error ? AppColors.dangerFg : AppColors.foreground,
    ));
}

String errorText(Object e) => e is ApiException ? e.display : e.toString();

/// Runs an action, shows its error as a toast. Returns true on success.
Future<bool> runAction(BuildContext context, Future<void> Function() action, {String? success}) async {
  try {
    await action();
    if (success != null && context.mounted) toast(context, success);
    return true;
  } catch (e) {
    if (context.mounted) toast(context, errorText(e), error: true);
    return false;
  }
}

/// Loads data, shows a spinner / error with retry, and supports pull-to-refresh.
class DataView<T> extends StatefulWidget {
  const DataView({super.key, required this.load, required this.builder});
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;

  @override
  State<DataView<T>> createState() => DataViewState<T>();
}

class DataViewState<T> extends State<DataView<T>> {
  T? _data;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    setState(() {
      _loading = _data == null;
      _error = null;
    });
    try {
      final d = await widget.load();
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) return const Center(child: CircularProgressIndicator());
    if (_error != null && _data == null) {
      return ErrorView(error: _error!, onRetry: reload);
    }
    return RefreshIndicator(
      onRefresh: reload,
      child: widget.builder(context, _data as T, reload),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final offline = error is ApiException && (error as ApiException).status == 0;
    return ListView(
      padding: const EdgeInsets.all(32),
      children: [
        const SizedBox(height: 60),
        Center(
          child: Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: BorderRadius.circular(14),
              color: Colors.white,
            ),
            child: Icon(offline ? Icons.wifi_off_rounded : Icons.error_outline,
                color: AppColors.muted),
          ),
        ),
        const SizedBox(height: 16),
        Text(offline ? 'Can’t reach the server' : 'Something went wrong',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        Text(errorText(error),
            textAlign: TextAlign.center, style: const TextStyle(color: AppColors.muted)),
        const SizedBox(height: 20),
        Center(child: FilledButton(onPressed: onRetry, child: const Text('Retry'))),
      ],
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.body});
  final IconData icon;
  final String title;
  final String? body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 24),
      child: Column(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
                color: AppColors.infoSoft, borderRadius: BorderRadius.circular(14)),
            child: Icon(icon, color: AppColors.infoFg),
          ),
          const SizedBox(height: 12),
          Text(title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          if (body != null) ...[
            const SizedBox(height: 4),
            Text(body!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.muted)),
          ],
        ],
      ),
    );
  }
}

({Color bg, Color fg}) toneColors(String tone) => switch (tone) {
      'danger' => (bg: AppColors.dangerSoft, fg: AppColors.dangerFg),
      'warning' => (bg: AppColors.warningSoft, fg: AppColors.warningFg),
      'success' => (bg: AppColors.successSoft, fg: AppColors.successFg),
      'info' => (bg: AppColors.infoSoft, fg: AppColors.infoFg),
      _ => (bg: AppColors.neutralSoft, fg: AppColors.muted),
    };

String statusTone(String? s) => switch (s) {
      'OPEN' || 'NEW' || 'ASSIGNED' || 'SCHEDULED' || 'APPROVED' || 'ORDERED' => 'info',
      'IN_PROGRESS' || 'REVIEW' || 'PENDING_APPROVAL' || 'WARNING' || 'UNDER_MAINTENANCE' ||
      'PARTIALLY_RECEIVED' =>
        'warning',
      'ON_HOLD' || 'REOPENED' || 'REJECTED' || 'BROKEN' || 'FAIL' => 'danger',
      'COMPLETED' || 'VERIFIED' || 'CLOSED' || 'CONVERTED' || 'OPERATIONAL' || 'RECEIVED' ||
      'SUBMITTED' || 'PASS' || 'ACTIVE' =>
        'success',
      _ => 'neutral',
    };

String priorityTone(String? p) => switch (p) {
      'CRITICAL' => 'danger',
      'HIGH' => 'warning',
      'MEDIUM' => 'info',
      _ => 'neutral',
    };

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = 'neutral', this.icon, this.color});
  final String text;
  final String tone;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = toneColors(tone);
    final fg = color ?? c.fg;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color != null ? color!.withValues(alpha: 0.12) : c.bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 12, color: fg), const SizedBox(width: 4)],
        Text(text, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: fg)),
      ]),
    );
  }
}

class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key});
  final String? status;
  @override
  Widget build(BuildContext context) => Pill(label(status), tone: statusTone(status));
}

class PriorityBadge extends StatelessWidget {
  const PriorityBadge(this.priority, {super.key});
  final String? priority;
  @override
  Widget build(BuildContext context) => Pill(label(priority),
      tone: priorityTone(priority),
      icon: priority == 'CRITICAL' ? Icons.local_fire_department : null);
}

Color hexColor(String? hex) {
  final h = (hex ?? '#64748b').replaceAll('#', '');
  return Color(int.tryParse('FF$h', radix: 16) ?? 0xFF64748B);
}

class LabelChips extends StatelessWidget {
  const LabelChips(this.labels, {super.key});
  final List? labels;
  @override
  Widget build(BuildContext context) {
    final l = labels ?? const [];
    if (l.isEmpty) return const SizedBox.shrink();
    return Wrap(spacing: 6, runSpacing: 6, children: [
      for (final x in l) Pill((x as Map)['name'].toString(), color: hexColor(x['color'] as String?)),
    ]);
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.trailing});
  final String title;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 6, bottom: 8),
        child: Row(children: [
          Expanded(
              child: Text(title,
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
          ?trailing,
        ]),
      );
}

class Callout extends StatelessWidget {
  const Callout({super.key, required this.text, this.title, this.tone = 'info'});
  final String text;
  final String? title;
  final String tone;
  @override
  Widget build(BuildContext context) {
    final c = toneColors(tone);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (title != null)
          Text(title!, style: TextStyle(fontWeight: FontWeight.w600, color: c.fg)),
        Text(text, style: TextStyle(color: c.fg)),
      ]),
    );
  }
}

/// White rounded card with a border (the web's `rounded-xl border bg-card shadow-card`).
class AppCard extends StatelessWidget {
  const AppCard({super.key, required this.child, this.onTap, this.padding, this.borderColor});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry? padding;
  final Color? borderColor;
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: borderColor ?? AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding ?? const EdgeInsets.all(14), child: child),
      ),
    );
  }
}

/// Gradient greeting banner from the worker home.
class BrandHero extends StatelessWidget {
  const BrandHero({super.key, this.overline, required this.title, this.subtitle});
  final String? overline;
  final String title;
  final String? subtitle;
  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 22),
      decoration: BoxDecoration(
        gradient: AppColors.brand,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
              color: AppColors.brandFrom.withValues(alpha: 0.35),
              blurRadius: 24,
              offset: const Offset(0, 10)),
        ],
      ),
      child: Stack(clipBehavior: Clip.none, children: [
        Positioned(
          top: -50,
          right: -50,
          child: Container(
            width: 140,
            height: 140,
            decoration: BoxDecoration(
                shape: BoxShape.circle, color: Colors.white.withValues(alpha: 0.10)),
          ),
        ),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (overline != null)
            Text(overline!,
                style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.85),
                    fontSize: 13,
                    fontWeight: FontWeight.w500)),
          const SizedBox(height: 4),
          Text(title,
              style: const TextStyle(
                  color: Colors.white, fontSize: 24, fontWeight: FontWeight.w600)),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(subtitle!,
                style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 13.5)),
          ],
        ]),
      ]),
    );
  }
}

class IconChip extends StatelessWidget {
  const IconChip(this.icon, {super.key, this.tone = 'info', this.size = 38, this.brand = false});
  final IconData icon;
  final String tone;
  final double size;
  final bool brand;
  @override
  Widget build(BuildContext context) {
    final c = toneColors(tone);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: brand ? null : c.bg,
        gradient: brand ? AppColors.brand : null,
        borderRadius: BorderRadius.circular(size * 0.28),
      ),
      child: Icon(icon, size: size * 0.5, color: brand ? Colors.white : c.fg),
    );
  }
}

class Avatar extends StatelessWidget {
  const Avatar(this.person, {super.key, this.size = 36});
  final dynamic person;
  final double size;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: const BoxDecoration(shape: BoxShape.circle, gradient: AppColors.brand),
        child: Text(initials(person),
            style: TextStyle(
                color: Colors.white, fontWeight: FontWeight.w600, fontSize: size * 0.38)),
      );
}

/// Task card used by the worker lists and admin work order lists.
class TaskCard extends StatelessWidget {
  const TaskCard({super.key, required this.task, required this.onTap, this.showAssignee = false});
  final Map task;
  final VoidCallback onTap;
  final bool showAssignee;

  @override
  Widget build(BuildContext context) {
    final status = task['status']?.toString();
    final active = kActiveStatuses.contains(status);
    final due = active ? describeDue(task['dueDate']) : null;
    final overdue = task['overdue'] == true;
    final where = [
      (task['asset'] as Map?)?['name'],
      (task['location'] as Map?)?['name'],
      (task['restaurant'] as Map?)?['name'],
    ].whereType<String>().join(' · ');
    final team = (task['team'] ?? task['assignedTeam']) as Map?;
    final assignee = task['assignedUser'] ?? task['assignee'];
    return AppCard(
      onTap: onTap,
      borderColor: overdue ? AppColors.danger.withValues(alpha: 0.4) : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(task['code']?.toString() ?? '',
              style: const TextStyle(
                  fontSize: 12, color: AppColors.muted, fontWeight: FontWeight.w500)),
          if (task['type'] == 'PREVENTIVE') ...[
            const SizedBox(width: 6),
            const Icon(Icons.build_circle_outlined, size: 14, color: AppColors.infoFg),
          ],
          const Spacer(),
          StatusBadge(status),
        ]),
        const SizedBox(height: 6),
        Text(task['title']?.toString() ?? '',
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, height: 1.25)),
        if (where.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(where,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, color: AppColors.muted)),
        ],
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          PriorityBadge(task['priority']?.toString()),
          if (due != null && due.label.isNotEmpty)
            Text(due.label,
                style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w500,
                    color: toneColors(overdue ? 'danger' : due.tone).fg == AppColors.muted
                        ? AppColors.muted
                        : toneColors(overdue ? 'danger' : due.tone).fg)),
          if (showAssignee)
            Text(assignee != null ? personName(assignee) : team != null ? team['name'].toString() : 'Unassigned',
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted))
          else if (team != null)
            Text('via ${team['name']}', style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
        ]),
      ]),
    );
  }
}

/// Small key/value row for detail screens.
class InfoRow extends StatelessWidget {
  const InfoRow(this.k, this.v, {super.key});
  final String k;
  final String? v;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
              width: 120,
              child: Text(k, style: const TextStyle(color: AppColors.muted, fontSize: 13.5))),
          Expanded(
              child: Text(v == null || v!.isEmpty ? '—' : v!,
                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500))),
        ]),
      );
}

/// Asks for a text (reason / note). Returns null when cancelled.
Future<String?> askText(BuildContext context,
    {required String title, String? hint, String action = 'Save', int minLength = 0}) {
  final ctrl = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(builder: (ctx, setState) {
      final ok = ctrl.text.trim().length >= minLength;
      return AlertDialog(
        title: Text(title),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          maxLines: 3,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(hintText: hint),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
              onPressed: ok ? () => Navigator.pop(ctx, ctrl.text.trim()) : null,
              child: Text(action)),
        ],
      );
    }),
  );
}

Future<bool> confirm(BuildContext context, String title, {String? body, String action = 'Yes'}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: body == null ? null : Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(action)),
      ],
    ),
  );
  return r == true;
}

/// Picks one option from a bottom sheet.
Future<T?> pickOption<T>(BuildContext context, String title, List<(T, String)> options) {
  return showModalBottomSheet<T>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Align(
                alignment: Alignment.centerLeft,
                child: Text(title,
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600))),
          ),
          Flexible(
            child: ListView(shrinkWrap: true, children: [
              for (final o in options)
                ListTile(title: Text(o.$2), onTap: () => Navigator.pop(ctx, o.$1)),
            ]),
          ),
        ]),
      ),
    ),
  );
}
