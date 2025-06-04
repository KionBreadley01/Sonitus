import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart' as blue;

class BluetoothDeviceListTile extends StatelessWidget {
  final blue.BluetoothDevice device;
  final VoidCallback onTap;

  const BluetoothDeviceListTile({
    super.key,
    required this.device,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 8),
      leading: const Icon(Icons.devices, size: 16),
      title: Text(
        device.name.isNotEmpty ? device.name : 'Desconocido',
        style: const TextStyle(fontSize: 12),
        maxLines: 1,
      ),
      trailing: StreamBuilder<blue.BluetoothConnectionState>(
        stream: device.connectionState,
        builder: (c, snapshot) {
          return Icon(
            snapshot.data == blue.BluetoothConnectionState.connected
                ? Icons.bluetooth_connected
                : Icons.bluetooth,
            size: 16,
            color: snapshot.data == blue.BluetoothConnectionState.connected
                ? Colors.green
                : Colors.grey,
          );
        },
      ),
      onTap: onTap,
    );
  }
}
