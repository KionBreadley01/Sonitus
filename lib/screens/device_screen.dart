import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart' as blue;
import 'package:provider/provider.dart';
import 'package:sonitus_music/services/bluetooth_service.dart';
import 'package:sonitus_music/widgets/bluetooth_device_list_tile.dart';

class DeviceScreen extends StatefulWidget {
  const DeviceScreen({super.key});

  @override
  State<DeviceScreen> createState() => _DeviceScreenState();
}

class _DeviceScreenState extends State<DeviceScreen> {
  List<blue.BluetoothDevice> _devices = [];
  String _errorMessage = '';
  bool _isScanning = false;
  StreamSubscription<List<blue.BluetoothDevice>>? _scanSubscription;

  @override
  void initState() {
    super.initState();
    _startScan();
  }

  @override
  void dispose() {
    _scanSubscription?.cancel();
    Provider.of<BluetoothService>(context, listen: false).stopScan();
    super.dispose();
  }

  Future<void> _startScan() async {
    try {
      setState(() {
        _isScanning = true;
        _devices = [];
        _errorMessage = '';
      });

      final bluetoothService =
          Provider.of<BluetoothService>(context, listen: false);
      _scanSubscription = bluetoothService.scanDevices().listen((devices) {
        if (mounted) {
          setState(() =>
              _devices = devices.where((d) => d.name.isNotEmpty).toList());
        }
      });

      await Future.delayed(const Duration(seconds: 5));
      await bluetoothService.stopScan();
      if (mounted) setState(() => _isScanning = false);
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Error: ${e.toString()}';
          _isScanning = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dispositivos', style: TextStyle(fontSize: 14)),
        centerTitle: true,
        actions: [
          IconButton(
            icon: _isScanning
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh, size: 18),
            onPressed: _isScanning ? null : _startScan,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isScanning && _devices.isEmpty) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 1.5));
    }
    if (_errorMessage.isNotEmpty) {
      return Center(
          child: Text(_errorMessage, style: const TextStyle(fontSize: 12)));
    }
    if (_devices.isEmpty) {
      return const Center(
          child: Text('No hay dispositivos', style: TextStyle(fontSize: 12)));
    }

    return ListView.builder(
      padding: const EdgeInsets.only(top: 4),
      itemCount: _devices.length,
      itemBuilder: (context, index) => SizedBox(
        height: 48,
        child: BluetoothDeviceListTile(
          device: _devices[index],
          onTap: () => _connectToDevice(context, _devices[index]),
        ),
      ),
    );
  }

  Future<void> _connectToDevice(
      BuildContext context, blue.BluetoothDevice device) async {
    try {
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          title: const Text('Conectando...', style: TextStyle(fontSize: 14)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const LinearProgressIndicator(),
              const SizedBox(height: 8),
              Text('Conectando a ${device.name}',
                  style: const TextStyle(fontSize: 12)),
            ],
          ),
        ),
      );

      final bluetoothService =
          Provider.of<BluetoothService>(context, listen: false);
      final success = await bluetoothService.connectToDevice(device);

      if (mounted) {
        Navigator.pop(context);
        if (success) {
          Navigator.pop(context); // Regresar al reproductor
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error al conectar',
                  style: const TextStyle(fontSize: 12)),
              duration: const Duration(seconds: 2),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: ${e.toString()}',
                style: const TextStyle(fontSize: 12)),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    }
  }
}
