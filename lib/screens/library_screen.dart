import 'package:flutter/material.dart';

class LibraryScreen extends StatelessWidget {
  const LibraryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Biblioteca', style: TextStyle(fontSize: 14)),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.all(8),
        children: [
          _buildSection('Recientes'),
          const SizedBox(height: 4),
          _buildMusicCard(),
          const SizedBox(height: 8),
          _buildSection('Favoritas'),
          const SizedBox(height: 4),
          _buildMusicCard(),
        ],
      ),
    );
  }

  Widget _buildSection(String title) {
    return Text(title,
        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold));
  }

  Widget _buildMusicCard() {
    return Container(
      height: 60,
      decoration: BoxDecoration(
        color: Colors.grey[900],
        borderRadius: BorderRadius.circular(6),
      ),
      child: const Center(
          child: Text('Lista de canciones', style: TextStyle(fontSize: 10))),
    );
  }
}
