package expo.modules.bluetoothclassic

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.UUID

private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

class BluetoothClassicModule : Module() {
    private var socket: BluetoothSocket? = null

    override fun definition() = ModuleDefinition {
        Name("BluetoothClassic")

        AsyncFunction("getBondedDevices") {
            val adapter = BluetoothAdapter.getDefaultAdapter()
                ?: throw Exception("Bluetooth is not available on this device")

            if (!adapter.isEnabled) {
                throw Exception("Bluetooth is turned off. Enable it in your phone's settings.")
            }

            adapter.bondedDevices
                .filter { it.name != null && it.name.isNotBlank() }
                .map { device ->
                    mapOf(
                        "id" to (device.address ?: device.name),
                        "name" to device.name,
                    )
                }
        }

        AsyncFunction("connectToDevice") { address: String ->
            val adapter = BluetoothAdapter.getDefaultAdapter()
                ?: throw Exception("Bluetooth is not available")

            val device = adapter.getRemoteDevice(address)
                ?: throw Exception("Device not found: $address")

            // Close any existing connection
            try { socket?.close() } catch (_: Exception) {}

            socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            try {
                socket?.connect()
            } catch (e: IOException) {
                socket?.close()
                socket = null
                throw Exception("Could not connect to ${device.name}. Is it on, paired, and in range?")
            }
        }

        AsyncFunction("write") { data: String, encoding: String ->
            val out = socket?.outputStream ?: throw Exception("Not connected to a printer")

            val bytes = when (encoding) {
                "base64" -> Base64.decode(data, Base64.DEFAULT)
                else -> data.toByteArray(Charsets.UTF_8)
            }

            out.write(bytes)
            out.flush()
        }

        AsyncFunction("disconnect") {
            try {
                socket?.close()
            } catch (_: Exception) {}
            socket = null
            null
        }
    }
}
