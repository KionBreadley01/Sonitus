import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/bluetooth_service.dart';
import 'screens/splash_screen.dart';
import 'screens/player_screen.dart';
import 'screens/device_screen.dart';
import 'screens/library_screen.dart';

void main() {
  runApp(
    MultiProvider(
      providers: [
        Provider(create: (_) => BluetoothService()),
      ],
      child: const MusicControllerApp(),
    ),
  );
}

class MusicControllerApp extends StatelessWidget {
  const MusicControllerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Smart Music Controller',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: Colors.black,
      ),
      initialRoute: '/',
      routes: {
        '/': (context) => const SplashScreen(),
        '/player': (context) => const PlayerScreen(),
        '/device': (context) => const DeviceScreen(),
        '/library': (context) => const LibraryScreen(),
      },
    );
  }
}