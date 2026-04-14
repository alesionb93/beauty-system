// supabaseClient.js
var SUPABASE_URL = 'https://krmvgrfwoanzajlsvjvm.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtybXZncmZ3b2FuemFqbHN2anZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzY0MDcsImV4cCI6MjA5MTcxMjQwN30.1x4_zxPzCXONYBvH7wbkLiUPr-kq_T0KCdG3EhruzVQ';

var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
