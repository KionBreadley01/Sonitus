import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:provider/provider.dart';
import 'package:sonitus_music/services/bluetooth_service.dart';

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key});

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  final _player = AudioPlayer();
  bool _isPlaying = false;

  @override
  void initState() {
    super.initState();
    _player.setAsset('assets/audio/sample.mp3');
  }

  void _togglePlayPause() async {
    if (_isPlaying) {
      await _player.pause();
    } else {
      await _player.play();
    }
    setState(() {
      _isPlaying = !_isPlaying;
    });
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bluetoothService = Provider.of<BluetoothService>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Música', style: TextStyle(fontSize: 22)),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.devices, size: 15),
            onPressed: () => Navigator.pushNamed(context, '/device'),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            // Se ha eliminado el Icon(Icons.music_note)
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  icon: const Icon(Icons.skip_previous,
                      size: 45), // Reducido de 18 a 16
                  onPressed: () {},
                  padding: EdgeInsets.zero,
                ),
                const SizedBox(width: 6), // Reducido el espacio entre botones
                IconButton(
                  icon: Icon(
                    _isPlaying ? Icons.pause : Icons.play_arrow,
                    size: 30, // Reducido de 30 a 22
                  ),
                  onPressed: _togglePlayPause,
                  padding: EdgeInsets.zero,
                ),
                const SizedBox(width: 6), // Reducido el espacio entre botones
                IconButton(
                  icon: const Icon(Icons.skip_next,
                      size: 45), // Corregido de 100 a 16
                  onPressed: () {},
                  padding: EdgeInsets.zero,
                ),
              ],
            ),
            Text(
              bluetoothService.isConnected
                  ? 'BT: ${bluetoothService.connectedDevice?.name?.substring(0, 8) ?? 'Conectado'}'
                  : 'Sin conexión',
              style: const TextStyle(fontSize: 10),
            ),
          ],
        ),
      ),
    );
  }
}
