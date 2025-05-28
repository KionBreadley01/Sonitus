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

  Widget _controlButton(IconData icon, VoidCallback onPressed, {double size = 50}) {
    return IconButton(
      iconSize: size,
      icon: Icon(icon),
      onPressed: onPressed,
      color: Colors.white,
      padding: const EdgeInsets.all(12),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bluetoothService = Provider.of<BluetoothService>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reproductor'),
        actions: [
          IconButton(
            icon: const Icon(Icons.devices),
            onPressed: () => Navigator.pushNamed(context, '/device'),
          ),
          IconButton(
            icon: const Icon(Icons.library_music),
            onPressed: () => Navigator.pushNamed(context, '/library'),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            const Icon(Icons.music_note, size: 100),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _controlButton(Icons.skip_previous, () {}),
                const SizedBox(width: 20),
                _controlButton(
                    _isPlaying ? Icons.pause : Icons.play_arrow, _togglePlayPause,
                    size: 80),
                const SizedBox(width: 20),
                _controlButton(Icons.skip_next, () {}),
              ],
            ),
            if (bluetoothService.isConnected)
              Text('Conectado a ${bluetoothService.connectedDevice?.name ?? 'dispositivo'}',
                  style: const TextStyle(fontSize: 14))
            else
              const Text('No conectado', style: TextStyle(fontSize: 14)),
          ],
        ),
      ),
    );
  }
}