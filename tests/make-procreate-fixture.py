"""Generate a reproducible native-format stress fixture without artwork or user data."""
import argparse
import plistlib
import random
import struct
import uuid
import zipfile


def make_fixture(path, layers, video_mib, dense):
    objects = ['$null', None]

    def ref(value):
        objects.append(value)
        return plistlib.UID(len(objects) - 1)

    def list_ref(values):
        return ref({'NS.objects': values})

    doc_class = ref({'$classname': 'SilicaDocument'})
    layer_class = ref({'$classname': 'SilicaLayer'})
    group_class = ref({'$classname': 'SilicaGroup'})
    leaves = []
    canvas, tile = (8192 if dense else 4096), 256
    rng = random.Random(170)
    with zipfile.ZipFile(path, 'w', allowZip64=True) as archive:
        for index in range(layers):
            key = str(uuid.UUID(int=index + 1)).upper()
            leaves.append(ref({'$class': layer_class, 'name': ref(f'Trait {index + 1:04}'), 'UUID': ref(key),
                               'type': 0, 'hidden': index == 1, 'opacity': 1.0, 'blend': 0, 'mask': plistlib.UID(0)}))
            positions = ((x, y) for y in range(32) for x in range(32)) if dense else [(index % 16, index // 16 % 16)]
            for column, row in positions:
                pixels = bytearray(rng.randbytes(tile * tile * 4))
                pixels[3::4] = b'\xff' * (tile * tile)
                frame = b'bv4-' + struct.pack('<II', len(pixels), len(pixels)) + pixels + b'bv4$'
                archive.writestr(f'{key}/{column}~{row}.lz4', frame)
        basic = ref({'$class': group_class, 'name': ref('Basic'), 'isHidden': False, 'children': list_ref(leaves)})
        root = ref({'$class': group_class, 'name': ref('Heads'), 'isHidden': False, 'children': list_ref([basic])})
        objects[1] = {'$class': doc_class, 'size': ref(f'{{{canvas}, {canvas}}}'), 'tileSize': tile,
                      'orientation': 1, 'unwrappedLayers': list_ref([root])}
        plist = {'$archiver': 'NSKeyedArchiver', '$version': 100000, '$top': {'root': plistlib.UID(1)}, '$objects': objects}
        archive.writestr('Document.archive', plistlib.dumps(plist, fmt=plistlib.FMT_BINARY), zipfile.ZIP_DEFLATED)
        if video_mib:
            with archive.open('video/segments/segment-0.mp4', 'w', force_zip64=True) as video:
                megabyte = bytes(1024 * 1024)
                for _ in range(video_mib):
                    video.write(megabyte)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('--layers', type=int, default=12)
    parser.add_argument('--video-mib', type=int, default=0)
    parser.add_argument('--dense', action='store_true', help='write one fully painted 8192 × 8192 layer')
    args = parser.parse_args()
    make_fixture(args.path, 1 if args.dense else args.layers, args.video_mib, args.dense)
