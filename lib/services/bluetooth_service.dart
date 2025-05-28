import 'dart:async';
import 'package:flutter_blue_plus/flutter_blue_plus.dart' as blue;

class BluetoothService {
  blue.BluetoothDevice? _connectedDevice;
  bool _isScanning = false;
  StreamSubscription<blue.BluetoothConnectionState>? _connectionSubscription;

  blue.BluetoothDevice? get connectedDevice => _connectedDevice;
  bool get isConnected => _connectedDevice != null;
  bool get isScanning => _isScanning;

  Future<void> initialize() async {
    if (!await blue.FlutterBluePlus.isAvailable) {
      throw Exception("Bluetooth no disponible");
    }

    if (!await blue.FlutterBluePlus.isOn) {
      await blue.FlutterBluePlus.turnOn();
    }
  }

  Stream<List<blue.BluetoothDevice>> scanDevices({Duration timeout = const Duration(seconds: 10)}) {
    _isScanning = true;
    blue.FlutterBluePlus.startScan(timeout: timeout, withServices: []);
    
    return blue.FlutterBluePlus.scanResults.map((results) => results
        .map((r) => r.device)
        .where((device) => device.name.isNotEmpty)
        .toList());
  }

  Future<void> stopScan() async {
    await blue.FlutterBluePlus.stopScan();
    _isScanning = false;
  }

  Future<bool> connectToDevice(blue.BluetoothDevice device) async {
    try {
      // Cancelar cualquier conexión existente
      await disconnectDevice();

      // Configurar timeout de conexión
      final timeout = const Duration(seconds: 15);
      final completer = Completer<bool>();

      // Escuchar cambios de estado
      _connectionSubscription = device.connectionState.listen((state) async {
        if (state == blue.BluetoothConnectionState.connected) {
          _connectedDevice = device;
          if (!completer.isCompleted) completer.complete(true);
        } else if (state == blue.BluetoothConnectionState.disconnected) {
          _connectedDevice = null;
          if (!completer.isCompleted) completer.complete(false);
        }
      });

      // Intentar conectar
      await device.connect(autoConnect: false, timeout: timeout);

      return await completer.future;
    } catch (e) {
      _connectedDevice = null;
      rethrow;
    }
  }

  Future<void> disconnectDevice() async {
    await _connectionSubscription?.cancel();
    _connectionSubscription = null;
    
    if (_connectedDevice != null) {
      try {
        await _connectedDevice!.disconnect();
      } finally {
        _connectedDevice = null;
      }
    }
  }

  Future<List<blue.BluetoothService>> discoverServices(blue.BluetoothDevice device) async {
    return await device.discoverServices();
  }
}