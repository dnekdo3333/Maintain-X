import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/format.dart';
import '../core/theme.dart';
import 'common.dart';

/// Takes a photo or picks from the gallery (compressed like the web app does).
Future<List<File>> pickPhotos(BuildContext context, {bool multiple = true}) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(
          leading: const Icon(Icons.photo_camera_outlined),
          title: const Text('Take photo'),
          onTap: () => Navigator.pop(ctx, ImageSource.camera),
        ),
        ListTile(
          leading: const Icon(Icons.photo_library_outlined),
          title: const Text('Choose from gallery'),
          onTap: () => Navigator.pop(ctx, ImageSource.gallery),
        ),
        const SizedBox(height: 8),
      ]),
    ),
  );
  if (source == null) return [];
  final picker = ImagePicker();
  try {
    if (source == ImageSource.gallery && multiple) {
      final files = await picker.pickMultiImage(maxWidth: 1600, imageQuality: 80, limit: 6);
      return [for (final f in files) File(f.path)];
    }
    final f = await picker.pickImage(source: source, maxWidth: 1600, imageQuality: 80);
    return f == null ? [] : [File(f.path)];
  } catch (e) {
    if (context.mounted) toast(context, 'Camera/gallery open nahi hua: $e', error: true);
    return [];
  }
}

/// Grid of attachment thumbnails; tap to open full screen.
class PhotoGrid extends StatelessWidget {
  const PhotoGrid(this.items, {super.key, this.columns = 3});
  final List? items;
  final int columns;

  @override
  Widget build(BuildContext context) {
    final photos = [
      for (final a in items ?? const [])
        if ((a as Map)['kind'] == 'PHOTO' && a['removed'] != true) a
    ];
    if (photos.isEmpty) return const SizedBox.shrink();
    final api = apiOf(context);
    return GridView.count(
      crossAxisCount: columns,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      children: [
        for (final p in photos)
          GestureDetector(
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => PhotoViewer(
                url: api.fileUrl(p['url'] as String?),
                caption: [
                  if (p['stage'] != null) label(p['stage']),
                  if (p['caption'] != null) p['caption'].toString(),
                ].join(' · '),
              ),
            )),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Stack(fit: StackFit.expand, children: [
                Image.network(
                  api.fileUrl((p['thumbUrl'] ?? p['url']) as String?),
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => Container(
                    color: AppColors.neutralSoft,
                    child: const Icon(Icons.broken_image_outlined, color: AppColors.muted),
                  ),
                  loadingBuilder: (_, child, progress) => progress == null
                      ? child
                      : Container(color: AppColors.neutralSoft),
                ),
                if (p['stage'] != null)
                  Positioned(
                    left: 6,
                    top: 6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.55),
                          borderRadius: BorderRadius.circular(6)),
                      child: Text(label(p['stage']),
                          style: const TextStyle(color: Colors.white, fontSize: 10.5)),
                    ),
                  ),
              ]),
            ),
          ),
      ],
    );
  }
}

class PhotoViewer extends StatelessWidget {
  const PhotoViewer({super.key, required this.url, this.caption = ''});
  final String url;
  final String caption;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(caption, style: const TextStyle(color: Colors.white, fontSize: 15)),
      ),
      body: Center(
        child: InteractiveViewer(
          maxScale: 5,
          child: Image.network(url,
              errorBuilder: (_, _, _) =>
                  const Icon(Icons.broken_image_outlined, color: Colors.white54, size: 48)),
        ),
      ),
    );
  }
}
