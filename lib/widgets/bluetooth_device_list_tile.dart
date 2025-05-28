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
      leading: const Icon(Icons.devices),
      title: Text(device.name.isNotEmpty ? device.name : 'Dispositivo desconocido'),
      subtitle: Text(device.id.toString()),
      trailing: StreamBuilder<blue.BluetoothConnectionState>(
        stream: device.connectionState,
        initialData: blue.BluetoothConnectionState.disconnected,
        builder: (c, snapshot) {
          return Icon(
            snapshot.data == blue.BluetoothConnectionState.connected
                ? Icons.bluetooth_connected
                : Icons.bluetooth,
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
