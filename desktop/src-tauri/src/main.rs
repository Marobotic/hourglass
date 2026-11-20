// The console window stays away in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() { hourglass_lib::run() }
