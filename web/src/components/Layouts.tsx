import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CasinoIcon from '@mui/icons-material/Casino';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/Notifications';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  AppBar, Box, Container, Divider, Drawer, IconButton, Link, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Typography, useMediaQuery,
} from '@mui/material';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link as RLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Cargando } from './comunes';

export function useConfigPublica() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.from('configuraciones').select('cla
