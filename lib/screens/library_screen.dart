import 'package:flutter/material.dart';

class LibraryScreen extends StatelessWidget {
  const LibraryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Biblioteca'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Recientes', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 20),
            Container(
              width: double.infinity,
              height: 100,
              color: Colors.grey[900],
              child: const Center(child: Text('Aquí irán tus canciones recientes')),
            ),
            const SizedBox(height: 40),
            const Text('Me gusta', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 20),
            Container(
              width: double.infinity,
              height: 100,
              color: Colors.grey[900],
              child: const Center(child: Text('Aquí irán tus favoritas')),
            ),
          ],
        ),
      ),
    );
  }
}
