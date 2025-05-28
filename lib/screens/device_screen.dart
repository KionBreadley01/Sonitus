import 'dart:async'; 
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart' as blue;
import 'package:sonitus_music/services/bluetooth_service.dart';
import 'package:sonitus_music/widgets/bluetooth_device_list_tile.dart';

class DeviceScreen extends StatefulWidget {
  const DeviceScreen({super.key});

  @override
  State<DeviceScreen> createState() => _DeviceScreenState();
}

class _DeviceScreenState extends State<DeviceScreen> {
  final BluetoothService _bluetoothService = BluetoothService();
  List<blue.BluetoothDevice> _devices = [];
  String _errorMessage = '';
  bool _isInitializing = true;
  StreamSubscription<List<blue.BluetoothDevice>>? _scanSubscription;

  @override
  void initState() {
    super.initState();
    _initBluetooth();
  }

  @override
  void dispose() {
    _scanSubscription?.cancel();
    _bluetoothService.stopScan();
    super.dispose();
  }

  Future<void> _initBluetooth() async {
    try {
      await _bluetoothService.initialize();
      await _startScan();
    } catch (e) {
      setState(() => _errorMessage = e.toString());
    } finally {
      if (mounted) setState(() => _isInitializing = false);
    }
  }

  Future<void> _startScan() async {
    try {
      setState(() {
        _devices = [];
        _errorMessage = '';
      });

      _scanSubscription = _bluetoothService.scanDevices().listen((devices) {
        if (mounted) {
          setState(() => _devices = devices.where((d) => d.name.isNotEmpty).toList());
        }
      });

      await Future.delayed(const Duration(seconds: 10));
      await _bluetoothService.stopScan();
    } catch (e) {
      if (mounted) setState(() => _errorMessage = 'Error al escanear: ${e.toString()}');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dispositivos cercanos'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _startScan,
            tooltip: 'Escanear de nuevo',
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isInitializing) return const Center(child: CircularProgressIndicator());
    if (_errorMessage.isNotEmpty) return Center(child: Text(_errorMessage));
    if (_devices.isEmpty) return const Center(child: Text('No se encontraron dispositivos'));
    
    return ListView.builder(
      itemCount: _devices.length,
      itemBuilder: (context, index) => BluetoothDeviceListTile(
        device: _devices[index],
        onTap: () => _connectToDevice(context, _devices[index]),
      ),
    );
  }

  Future<void> _connectToDevice(BuildContext context, blue.BluetoothDevice device) async {
    try {
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => const AlertDialog(
          title: Text('Conectando...'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              LinearProgressIndicator(),
              SizedBox(height: 16),
              Text('Estableciendo conexión...', style: TextStyle(fontSize: 14)),
            ],
          ),
        ),
      );

      final success = await _bluetoothService.connectToDevice(device);

      if (mounted) {
        Navigator.pop(context);
        
        if (success) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Conectado a ${device.name}')),
          );
          
          // Descubrir servicios después de conectar
          try {
            final services = await _bluetoothService.discoverServices(device);
            debugPrint('Servicios encontrados: ${services.length}');
            
            // Buscar servicio de audio (puedes ajustar estos UUIDs)
            const audioServiceUuid = '0000110B-0000-1000-8000-00805F9B34FB';
            final audioService = services.firstWhere(
              (s) => s.uuid.toString().toUpperCase() == audioServiceUuid,
              orElse: () => throw Exception('Servicio de audio no encontrado'),
            );
            
            debugPrint('Servicio de audio encontrado: ${audioService.uuid}');
            
            Navigator.pushNamed(context, '/player');
          } catch (e) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Error en servicios: ${e.toString()}')),
            );
            await _bluetoothService.disconnectDevice();
          }
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('No se pudo conectar a ${device.name}')),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: ${e.toString()}')),
        );
      }
    }
  }
}