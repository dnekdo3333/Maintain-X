import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'asset_screen.dart';
import 'inspection_screens.dart';
import 'report_screen.dart';
import 'work_order_screen.dart';

/// Opens the screen a notification / link points to (web paths).
void openAppLink(BuildContext context, String? url) {
  if (url == null) return;
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  final seg = uri.pathSegments;
  Widget? page;
  if (seg.length >= 2 && seg[0] == 'work-orders') page = WorkOrderScreen(id: seg[1]);
  if (seg.length >= 3 && seg[0] == 'w' && seg[1] == 'tasks') page = WorkOrderScreen(id: seg[2]);
  if (seg.length >= 2 && seg[0] == 'assets') page = AssetScreen(id: seg[1]);
  if (seg.length >= 2 && seg[0] == 'inspections') page = InspectionScreen(id: seg[1]);
  if (seg.isNotEmpty && seg[0] == 'requests' && uri.queryParameters['highlight'] != null) {
    page = RequestScreen(id: uri.queryParameters['highlight']!);
  }
  if (page != null) {
    final p = page;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => p));
  }
}

IconData notificationIcon(String? type) => switch (type) {
      'TASK_ASSIGNED' || 'WORK_REASSIGNED' => Icons.assignment_ind_outlined,
      'TASK_OVERDUE' || 'DUE_SOON' => Icons.alarm,
      'PM_DUE' => Icons.build_circle_outlined,
      'CRITICAL_ISSUE' => Icons.local_fire_department_outlined,
      'LOW_STOCK' => Icons.inventory_2_outlined,
      'TASK_COMPLETED' => Icons.task_alt,
      'NEW_REQUEST' || 'REQUEST_APPROVED' || 'REQUEST_REJECTED' => Icons.campaign_outlined,
      'PO_APPROVAL' || 'PO_RECEIVED' => Icons.receipt_long_outlined,
      'DOCUMENT_EXPIRY' || 'CONTRACT_EXPIRY' || 'WARRANTY_EXPIRY' => Icons.description_outlined,
      'NEW_MESSAGE' || 'CHAT_MESSAGE' || 'MENTION' => Icons.chat_bubble_outline,
      _ => Icons.notifications_none,
    };

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, this.embedded = false, this.onChanged});
  final bool embedded;
  final VoidCallback? onChanged;
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _key = GlobalKey<DataViewState<List>>();

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final body = DataView<List>(
      key: _key,
      load: () async => (await api.get('/notifications', {'pageSize': 50}) as Map)['data'] as List,
      builder: (context, items, reload) => items.isEmpty
          ? ListView(children: const [
              EmptyState(icon: Icons.notifications_none, title: 'No notifications', body: 'You’re all caught up.')
            ])
          : ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: items.length,
              separatorBuilder: (_, _) => const Divider(indent: 70),
              itemBuilder: (context, i) {
                final n = items[i] as Map;
                final unread = n['readAt'] == null;
                return ListTile(
                  tileColor: unread ? AppColors.infoSoft.withValues(alpha: 0.5) : null,
                  leading: IconChip(notificationIcon(n['type']?.toString()),
                      tone: n['priority'] == 'CRITICAL' ? 'danger' : n['priority'] == 'HIGH' ? 'warning' : 'info'),
                  title: Text(n['title'].toString(),
                      style: TextStyle(fontWeight: unread ? FontWeight.w600 : FontWeight.w500, fontSize: 14.5)),
                  subtitle: Text('${n['body'] ?? ''}\n${fmtRelative(n['createdAt'])}',
                      style: const TextStyle(fontSize: 12.5)),
                  isThreeLine: true,
                  onTap: () async {
                    if (unread) {
                      try {
                        await api.post('/notifications/${n['id']}/read');
                      } catch (_) {}
                      widget.onChanged?.call();
                      reload();
                    }
                    if (context.mounted) openAppLink(context, n['actionUrl']?.toString());
                  },
                );
              },
            ),
    );
    final readAll = IconButton(
      tooltip: 'Mark all as read',
      icon: const Icon(Icons.done_all),
      onPressed: () async {
        if (await runAction(context, () => api.post('/notifications/read-all'), success: 'All marked as read')) {
          widget.onChanged?.call();
          _key.currentState?.reload();
        }
      },
    );
    if (widget.embedded) {
      return Scaffold(appBar: AppBar(title: const Text('Notifications'), actions: [readAll]), body: body);
    }
    return Scaffold(appBar: AppBar(title: const Text('Notifications'), actions: [readAll]), body: body);
  }
}

// ---------------------------------------------------------------- chat

class ChatListScreen extends StatelessWidget {
  const ChatListScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Chat')),
      body: DataView<List>(
        load: () => api.getData<List>('/chats'),
        builder: (context, items, reload) => items.isEmpty
            ? ListView(children: const [EmptyState(icon: Icons.forum_outlined, title: 'No conversations yet')])
            : ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, _) => const Divider(indent: 72),
                itemBuilder: (context, i) {
                  final c = items[i] as Map;
                  final last = c['lastMessage'] as Map?;
                  final unread = (c['unread'] ?? 0) as int;
                  return ListTile(
                    leading: c['type'] == 'GROUP'
                        ? const IconChip(Icons.groups_outlined, size: 42, brand: true)
                        : Avatar(((c['members'] as List?)?.firstOrNull), size: 42),
                    title: Text(c['title'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text(last == null ? 'No messages' : '${last['authorName']}: ${last['body']}',
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                    trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text(fmtRelative(last?['createdAt'] ?? c['lastMessageAt']), style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                      if (unread > 0) ...[
                        const SizedBox(height: 4),
                        CircleAvatar(radius: 10, backgroundColor: AppColors.danger,
                            child: Text('$unread', style: const TextStyle(fontSize: 11, color: Colors.white))),
                      ],
                    ]),
                    onTap: () async {
                      await Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => ChatRoomScreen(id: c['id'].toString(), title: c['title'].toString())));
                      reload();
                    },
                  );
                },
              ),
      ),
    );
  }
}

class ChatRoomScreen extends StatefulWidget {
  const ChatRoomScreen({super.key, required this.id, required this.title});
  final String id;
  final String title;
  @override
  State<ChatRoomScreen> createState() => _ChatRoomScreenState();
}

class _ChatRoomScreenState extends State<ChatRoomScreen> {
  final _ctrl = TextEditingController();
  List _messages = const [];
  bool _loading = true;
  bool _sending = false;
  Object? _error;

  ApiClient get api => apiOf(context);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final page = await api.getData<Json>('/chats/${widget.id}/messages');
      if (!mounted) return;
      setState(() {
        _messages = (page['messages'] as List?) ?? const [];
        _loading = false;
        _error = null;
      });
      api.post('/chats/${widget.id}/read').catchError((_) => null);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _send() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      await api.post('/chats/${widget.id}/messages', {'body': text, 'workOrderId': ''});
      _ctrl.clear();
      await _load();
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(children: [
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? ErrorView(error: _error!, onRetry: _load)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        reverse: true,
                        padding: const EdgeInsets.all(12),
                        itemCount: _messages.length,
                        itemBuilder: (context, i) {
                          final m = _messages[_messages.length - 1 - i] as Map;
                          final mine = m['mine'] == true;
                          final wo = m['workOrder'] as Map?;
                          return Align(
                            alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
                              decoration: BoxDecoration(
                                color: mine ? AppColors.primary : Colors.white,
                                borderRadius: BorderRadius.circular(14),
                                border: mine ? null : Border.all(color: AppColors.border),
                              ),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                if (!mine)
                                  Text(personName(m['author']),
                                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.primary)),
                                Text(m['deleted'] == true ? 'Message deleted' : m['body'].toString(),
                                    style: TextStyle(color: mine ? Colors.white : AppColors.foreground, fontSize: 14.5)),
                                if (wo != null)
                                  InkWell(
                                    onTap: () => Navigator.of(context).push(
                                        MaterialPageRoute(builder: (_) => WorkOrderScreen(id: wo['id'].toString()))),
                                    child: Padding(
                                      padding: const EdgeInsets.only(top: 4),
                                      child: Text('🔗 ${wo['code'] ?? 'Work order'} ${wo['title'] ?? ''}',
                                          style: TextStyle(
                                              fontSize: 12.5,
                                              decoration: TextDecoration.underline,
                                              color: mine ? Colors.white : AppColors.primary)),
                                    ),
                                  ),
                                const SizedBox(height: 2),
                                Text(fmtTime(m['createdAt']),
                                    style: TextStyle(fontSize: 10.5, color: mine ? Colors.white70 : AppColors.muted)),
                              ]),
                            ),
                          );
                        },
                      ),
                    ),
        ),
        SafeArea(
          top: false,
          child: Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _ctrl,
                  minLines: 1,
                  maxLines: 4,
                  decoration: const InputDecoration(hintText: 'Message', isDense: true),
                ),
              ),
              IconButton(
                onPressed: _sending ? null : _send,
                icon: _sending
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.send_rounded, color: AppColors.primary),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

// ---------------------------------------------------------------- account & places

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final u = s.user ?? const {};
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        AppCard(
          child: Row(children: [
            Avatar(u, size: 56),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.fullName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                Text(s.roleName, style: const TextStyle(color: AppColors.muted)),
              ]),
            ),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(children: [
            InfoRow('Username', u['username']?.toString()),
            InfoRow('Email', u['email']?.toString()),
            InfoRow('Phone', u['phone']?.toString()),
            InfoRow('Restaurants', s.restaurants.map((r) => r['name']).join('\n')),
            InfoRow('Server', s.api.server),
          ]),
        ),
        const SizedBox(height: 20),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(foregroundColor: AppColors.dangerFg),
          onPressed: () async {
            if (await confirm(context, 'Sign out?', action: 'Sign out')) {
              if (context.mounted) {
                Navigator.of(context).popUntil((r) => r.isFirst);
                await context.read<Session>().logout();
              }
            }
          },
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
        ),
      ]),
    );
  }
}

class RestaurantsScreen extends StatelessWidget {
  const RestaurantsScreen({super.key, this.mine = true});
  final bool mine;
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(mine ? 'My restaurants' : 'Restaurants')),
      body: DataView<List>(
        load: () async => mine
            ? await api.getData<List>('/me/restaurants')
            : (await api.get('/restaurants', {'pageSize': 100}) as Map)['data'] as List,
        builder: (context, items, _) => ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (context, i) {
            final r = items[i] as Map;
            return AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const IconChip(Icons.storefront_outlined),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(r['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                      Text(r['code'].toString(), style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                    ]),
                  ),
                  if (r['openTasks'] != null) Pill('${r['openTasks']} open', tone: 'info'),
                ]),
                const SizedBox(height: 8),
                Text([r['addressLine1'], r['city']].whereType<String>().join(', '),
                    style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                if (r['opensAt'] != null)
                  Text('Open ${r['opensAt']} – ${r['closesAt']}', style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                if (r['manager'] != null)
                  Text('Manager: ${personName(r['manager'])}', style: const TextStyle(fontSize: 13)),
                if (r['phone'] != null) ...[
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
                    onPressed: () => launchUrl(Uri.parse('tel:${r['phone']}')),
                    icon: const Icon(Icons.call_outlined, size: 18),
                    label: Text(r['phone'].toString()),
                  ),
                ],
              ]),
            );
          },
        ),
      ),
    );
  }
}

/// Next 14 days of the worker's planned work.
class ScheduleScreen extends StatelessWidget {
  const ScheduleScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Schedule')),
      body: DataView<Json>(
        load: () => api.getData<Json>('/me/schedule', {'days': 14}),
        builder: (context, s, _) {
          final days = ((s['days'] as List?) ?? const []).where((d) => ((d as Map)['tasks'] as List).isNotEmpty).toList();
          if (days.isEmpty) {
            return ListView(children: const [
              EmptyState(icon: Icons.event_available_outlined, title: 'Nothing planned', body: 'No tasks in the next 14 days.')
            ]);
          }
          return ListView(padding: const EdgeInsets.all(16), children: [
            for (final d in days) ...[
              SectionTitle(fmtDate((d as Map)['date'])),
              for (final t in d['tasks'] as List)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TaskCard(
                    task: t as Map,
                    onTap: () => Navigator.of(context)
                        .push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: t['id'].toString()))),
                  ),
                ),
            ],
          ]);
        },
      ),
    );
  }
}
