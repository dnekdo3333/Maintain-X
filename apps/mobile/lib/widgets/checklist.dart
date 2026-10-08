import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import 'common.dart';
import 'photos.dart';

/// Answers a step: `{result, numericValue?, textValue, note}` like the web's StepAnswerInput.
typedef AnswerFn = Future<void> Function(String itemId, Map<String, dynamic> answer);
typedef UploadFn = Future<void> Function(String itemId);

({int answered, int total, int failed}) checklistProgress(List items) {
  var answered = 0, total = 0, failed = 0;
  for (final i in items) {
    final m = i as Map;
    if (m['inputType'] == 'SECTION') continue;
    total++;
    final hasPhoto = (m['attachments'] as List? ?? const []).isNotEmpty;
    if (m['result'] != null || (m['inputType'] == 'PHOTO' && hasPhoto)) answered++;
    if (m['result'] == 'FAIL') failed++;
  }
  return (answered: answered, total: total, failed: failed);
}

class ChecklistView extends StatelessWidget {
  const ChecklistView({
    super.key,
    required this.items,
    required this.editable,
    required this.onAnswer,
    required this.onUpload,
  });
  final List items;
  final bool editable;
  final AnswerFn onAnswer;
  final UploadFn onUpload;

  bool _visible(Map item) {
    final cond = item['showIf'] as Map?;
    if (cond == null) return true;
    final parent = items.cast<Map>().where((i) => i['position'] == cond['step']).firstOrNull;
    if (parent == null) return true;
    final answer = parent['result'] ?? parent['textValue'];
    return answer?.toString() == cond['answer']?.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      for (final raw in items)
        if (_visible(raw as Map))
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: raw['inputType'] == 'SECTION'
                ? Align(
                    alignment: Alignment.centerLeft,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(raw['title'].toString(),
                          style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.muted)),
                    ),
                  )
                : _StepCard(item: raw, editable: editable, onAnswer: onAnswer, onUpload: onUpload),
          ),
    ]);
  }
}

class _StepCard extends StatefulWidget {
  const _StepCard({required this.item, required this.editable, required this.onAnswer, required this.onUpload});
  final Map item;
  final bool editable;
  final AnswerFn onAnswer;
  final UploadFn onUpload;
  @override
  State<_StepCard> createState() => _StepCardState();
}

class _StepCardState extends State<_StepCard> {
  late final TextEditingController _ctrl;
  bool _busy = false;

  Map get i => widget.item;

  @override
  void initState() {
    super.initState();
    final v = i['inputType'] == 'NUMBER' ? i['numericValue'] : i['textValue'];
    _ctrl = TextEditingController(text: v == null ? '' : v.toString());
  }

  Future<void> _answer(Map<String, dynamic> a) async {
    setState(() => _busy = true);
    try {
      await widget.onAnswer(i['id'].toString(), {'textValue': '', 'note': '', ...a});
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _upload() async {
    setState(() => _busy = true);
    try {
      await widget.onUpload(i['id'].toString());
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = i['result']?.toString();
    final type = i['inputType'].toString();
    final range = [
      if (i['minValue'] != null || i['maxValue'] != null)
        '${i['minValue'] ?? '–'} to ${i['maxValue'] ?? '–'}${i['unit'] != null ? ' ${i['unit']}' : ''}'
    ];
    final attachments = i['attachments'] as List? ?? const [];
    final corrective = i['correctiveWorkOrder'] as Map?;
    return AppCard(
      borderColor: result == 'FAIL' ? AppColors.danger.withValues(alpha: 0.45) : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 24,
            height: 24,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: result == 'PASS'
                  ? AppColors.success
                  : result == 'FAIL'
                      ? AppColors.danger
                      : AppColors.neutralSoft,
            ),
            child: result == 'PASS'
                ? const Icon(Icons.check, size: 15, color: Colors.white)
                : result == 'FAIL'
                    ? const Icon(Icons.close, size: 15, color: Colors.white)
                    : Text('${i['position']}', style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(i['title'].toString() + (i['required'] == true ? '' : ' (optional)'),
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
              if (i['instruction'] != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(i['instruction'].toString(),
                      style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                ),
              if (range.isNotEmpty)
                Text('Allowed: ${range.first}', style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
            ]),
          ),
          if (_busy) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
        ]),
        const SizedBox(height: 10),
        _input(type, result),
        if (attachments.isNotEmpty) ...[const SizedBox(height: 10), PhotoGrid(attachments, columns: 4)],
        if (widget.editable && (i['requirePhoto'] == true || type == 'PHOTO')) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _busy ? null : _upload,
            icon: const Icon(Icons.add_a_photo_outlined, size: 18),
            label: Text(i['requirePhoto'] == true && type != 'PHOTO' ? 'Add photo (required)' : 'Add photo'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)),
          ),
        ],
        if (i['completedBy'] != null && i['completedAt'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('${personName(i['completedBy'])} · ${fmtDateTime(i['completedAt'])}',
                style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          ),
        if (i['note'] != null && i['note'].toString().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text('Note: ${i['note']}', style: const TextStyle(fontSize: 13)),
          ),
        if (corrective != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Pill('Corrective work order ${corrective['code']}', tone: 'warning'),
          ),
      ]),
    );
  }

  Widget _input(String type, String? result) {
    final enabled = widget.editable && !_busy;
    switch (type) {
      case 'PASS_FAIL_NA':
        return Row(children: [
          for (final r in const ['PASS', 'FAIL', 'NA']) ...[
            Expanded(
              child: _ResultButton(
                text: label(r),
                selected: result == r,
                tone: r == 'PASS' ? 'success' : r == 'FAIL' ? 'danger' : 'neutral',
                onTap: enabled ? () => _answer({'result': result == r ? '' : r}) : null,
              ),
            ),
            if (r != 'NA') const SizedBox(width: 8),
          ],
        ]);
      case 'CHECKBOX':
        return CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: result == 'PASS',
          onChanged: enabled ? (v) => _answer({'result': v == true ? 'PASS' : ''}) : null,
          title: const Text('Done'),
          controlAffinity: ListTileControlAffinity.leading,
        );
      case 'NUMBER':
        return Row(children: [
          Expanded(
            child: TextField(
              controller: _ctrl,
              enabled: enabled,
              keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
              decoration: InputDecoration(
                hintText: 'Reading',
                suffixText: i['unit']?.toString(),
                isDense: true,
              ),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(
            onPressed: enabled
                ? () {
                    final v = num.tryParse(_ctrl.text.trim());
                    if (v == null) {
                      toast(context, 'Number daalein', error: true);
                      return;
                    }
                    _answer({'result': '', 'numericValue': v});
                  }
                : null,
            style: FilledButton.styleFrom(minimumSize: const Size(72, 46)),
            child: const Text('Save'),
          ),
        ]);
      case 'TEXT':
        return Row(children: [
          Expanded(
            child: TextField(
              controller: _ctrl,
              enabled: enabled,
              decoration: const InputDecoration(hintText: 'Answer', isDense: true),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(
            onPressed: enabled ? () => _answer({'result': '', 'textValue': _ctrl.text.trim()}) : null,
            style: FilledButton.styleFrom(minimumSize: const Size(72, 46)),
            child: const Text('Save'),
          ),
        ]);
      case 'MULTIPLE_CHOICE':
        final options = (i['options'] as List? ?? const []).map((e) => e.toString()).toList();
        return Wrap(spacing: 8, runSpacing: 8, children: [
          for (final o in options)
            ChoiceChip(
              label: Text(o),
              selected: i['textValue'] == o,
              onSelected: enabled ? (_) => _answer({'result': '', 'textValue': o}) : null,
            ),
        ]);
      case 'PHOTO':
        return const SizedBox.shrink();
      case 'SIGNATURE':
        return const Text('Signature: add it from the web app.',
            style: TextStyle(fontSize: 13, color: AppColors.muted));
      default:
        return const SizedBox.shrink();
    }
  }
}

class _ResultButton extends StatelessWidget {
  const _ResultButton({required this.text, required this.selected, required this.tone, this.onTap});
  final String text;
  final bool selected;
  final String tone;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final c = toneColors(tone);
    return Material(
      color: selected ? c.bg : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: selected ? c.fg : AppColors.border, width: selected ? 1.6 : 1),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: SizedBox(
          height: 46,
          child: Center(
            child: Text(text,
                style: TextStyle(fontWeight: FontWeight.w600, color: selected ? c.fg : AppColors.foreground)),
          ),
        ),
      ),
    );
  }
}
